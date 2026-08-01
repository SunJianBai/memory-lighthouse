#!/usr/bin/env bash
set -Eeuo pipefail

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_path" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
release_root="$(CDPATH= cd -- "$production_dir/../.." && pwd -P)"
release_id="$(basename -- "$release_root")"
revision_file="$release_root/.openbmb-release-sha"
source_digest_file="$release_root/.openbmb-source-sha256"
manifest_file="$release_root/.openbmb-images"
transport_manifest_file="$release_root/.openbmb-transport-digests"

fail() {
  printf 'RELEASE IMAGE VERIFICATION FAILED: %s\n' "$*" >&2
  exit 1
}

[[ -f "$revision_file" ]] || fail 'missing release revision marker'
[[ -f "$source_digest_file" ]] || fail 'missing source archive digest marker'
[[ -f "$manifest_file" ]] || fail 'missing image identity manifest'
[[ -f "$transport_manifest_file" ]] || fail 'missing transport digest manifest'
[[ "$(stat -c %U "$release_root")" == root ]] || fail 'release root must be owned by root'
if find "$release_root" -xdev \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
  fail 'release tree must be root-owned and not group/world writable'
fi

release_revision="$(<"$revision_file")"
source_digest="$(<"$source_digest_file")"
[[ "$release_revision" =~ ^[0-9a-f]{40}$ ]] || fail 'release revision marker is invalid'
[[ "$source_digest" =~ ^[0-9a-f]{64}$ ]] || fail 'source archive digest marker is invalid'
[[ "$release_id" == "git-${release_revision:0:12}" ]] || fail 'release directory does not match revision marker'

[[ "$(stat -c %a "$release_root/infra/redis/redis.conf")" == 444 ]] || \
  fail 'Redis configuration must remain container-readable and immutable'
[[ "$(stat -c %a "$release_root/infra/redis/start-livekit-redis.sh")" == 555 ]] || \
  fail 'Redis startup helper must remain container-executable and immutable'
[[ "$(stat -c %a "$release_root/infra/production/livekit/livekit.production.yaml")" == 444 ]] || \
  fail 'LiveKit configuration must remain container-readable and immutable'

export OPENBMB_RELEASE="$release_id"
image_set_file="$script_dir/release-image-set.sh"
[[ -f "$image_set_file" && ! -L "$image_set_file" ]] || \
  fail 'release image set definition is missing'
# shellcheck source=release-image-set.sh
source "$image_set_file"
openbmb_load_release_image_set "$release_id" || fail 'release image set definition is invalid'
expected_images=("${OPENBMB_REQUIRED_IMAGES[@]}")
delivery_components=("${OPENBMB_DELIVERY_COMPONENTS[@]}")
mapfile -t required_images < <(
  OPENBMB_APPLICATION_RELEASE="$release_id" \
    OPENBMB_INFRASTRUCTURE_RELEASE="$release_id" \
    bash "$script_dir/compose.sh" --profile tools config --images | sort -u
)
mapfile -t expected_images_sorted < <(printf '%s\n' "${expected_images[@]}" | sort -u)
[[ "${#required_images[@]}" -eq "${#expected_images_sorted[@]}" ]] || \
  fail 'resolved Compose image count differs from the release image set'
for index in "${!required_images[@]}"; do
  [[ "${required_images[$index]}" == "${expected_images_sorted[$index]}" ]] || \
    fail 'resolved Compose image set differs from the release image set'
done

awk 'NF != 2 { exit 1 }' "$manifest_file" || fail 'manifest entries must contain an image name and ID'
awk 'NF != 3 { exit 1 }' "$transport_manifest_file" || \
  fail 'transport entries must contain an image name, delivery reference, and digest'
mapfile -t manifest_images < <(awk '{ print $1 }' "$manifest_file" | sort)
mapfile -t transport_images < <(awk '{ print $1 }' "$transport_manifest_file" | sort)
[[ "${#manifest_images[@]}" -eq "${#required_images[@]}" ]] || \
  fail 'manifest image count differs from resolved Compose image count'
[[ "${#transport_images[@]}" -eq "${#required_images[@]}" ]] || \
  fail 'transport image count differs from resolved Compose image count'
for index in "${!required_images[@]}"; do
  [[ "${manifest_images[$index]}" == "${required_images[$index]}" ]] || \
    fail 'manifest image set differs from the resolved Compose image set'
  [[ "${transport_images[$index]}" == "${required_images[$index]}" ]] || \
    fail 'transport image set differs from the resolved Compose image set'
done

delivery_repository=''
for index in "${!expected_images[@]}"; do
  image_name="${expected_images[$index]}"
  delivery_component="${delivery_components[$index]}"
  mapfile -t expected_ids < <(
    awk -v image="$image_name" '$1 == image { print $2 }' "$manifest_file"
  )
  [[ "${#expected_ids[@]}" -eq 1 ]] || fail "manifest must contain exactly one entry for $image_name"
  expected_id="${expected_ids[0]}"
  [[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "manifest image ID is invalid for $image_name"
  actual_id="$(docker image inspect --format '{{.Id}}' "$image_name" 2>/dev/null || true)"
  [[ "$actual_id" == "$expected_id" ]] || fail "local image identity differs for $image_name"

  mapfile -t transport_records < <(
    awk -v image="$image_name" '$1 == image { print $2 " " $3 }' \
      "$transport_manifest_file"
  )
  [[ "${#transport_records[@]}" -eq 1 ]] || \
    fail "transport manifest must contain exactly one entry for $image_name"
  read -r delivery_ref delivery_digest trailing <<<"${transport_records[0]}"
  [[ "$delivery_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || \
    fail "transport digest is invalid for $image_name"
  [[ -z "${trailing:-}" ]] || fail "transport entry contains trailing fields for $image_name"
  current_delivery_repository="${delivery_ref%:*}"
  [[ "$current_delivery_repository" =~ ^ghcr\.io/[a-z0-9][a-z0-9-]*/memory-lighthouse-delivery$ ]] || \
    fail "transport repository is invalid for $image_name"
  [[ "$delivery_ref" == "$current_delivery_repository:$delivery_component-$release_id" ]] || \
    fail "transport reference is invalid for $image_name"
  if [[ -z "$delivery_repository" ]]; then
    delivery_repository="$current_delivery_repository"
  else
    [[ "$current_delivery_repository" == "$delivery_repository" ]] || \
      fail 'transport entries must use one delivery repository'
  fi
done

application_images=(
  "openbmb-api:$release_id"
  "openbmb-migrator:$release_id"
  "openbmb-client-web:$release_id"
  "openbmb-admin-web:$release_id"
)
for image_name in "${application_images[@]}"; do
  image_revision="$(
    docker image inspect \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
      "$image_name"
  )"
  [[ "$image_revision" == "$release_revision" ]] || fail "OCI revision differs for $image_name"
done

printf 'Release image identities verified: %s\n' "$release_id"
