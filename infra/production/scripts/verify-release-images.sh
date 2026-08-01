#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
release_root="$(CDPATH= cd -- "$production_dir/../.." && pwd -P)"
release_id="$(basename -- "$release_root")"
revision_file="$release_root/.openbmb-release-sha"
source_digest_file="$release_root/.openbmb-source-sha256"
manifest_file="$release_root/.openbmb-images"

fail() {
  printf 'RELEASE IMAGE VERIFICATION FAILED: %s\n' "$*" >&2
  exit 1
}

[[ -f "$revision_file" ]] || fail 'missing release revision marker'
[[ -f "$source_digest_file" ]] || fail 'missing source archive digest marker'
[[ -f "$manifest_file" ]] || fail 'missing image identity manifest'
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
mapfile -t required_images < <(
  bash "$script_dir/compose.sh" --profile tools config --images | sort -u
)
[[ "${#required_images[@]}" -ge 9 ]] || fail 'resolved Compose image set is incomplete'

awk 'NF != 2 { exit 1 }' "$manifest_file" || fail 'manifest entries must contain an image name and ID'
mapfile -t manifest_images < <(awk '{ print $1 }' "$manifest_file" | sort)
[[ "${#manifest_images[@]}" -eq "${#required_images[@]}" ]] || \
  fail 'manifest image count differs from resolved Compose image count'
for index in "${!required_images[@]}"; do
  [[ "${manifest_images[$index]}" == "${required_images[$index]}" ]] || \
    fail 'manifest image set differs from the resolved Compose image set'
done

for image_name in "${required_images[@]}"; do
  mapfile -t expected_ids < <(
    awk -v image="$image_name" '$1 == image { print $2 }' "$manifest_file"
  )
  [[ "${#expected_ids[@]}" -eq 1 ]] || fail "manifest must contain exactly one entry for $image_name"
  expected_id="${expected_ids[0]}"
  [[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "manifest image ID is invalid for $image_name"
  actual_id="$(docker image inspect --format '{{.Id}}' "$image_name" 2>/dev/null || true)"
  [[ "$actual_id" == "$expected_id" ]] || fail "local image identity differs for $image_name"
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
