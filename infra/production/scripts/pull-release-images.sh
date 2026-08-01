#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
image_set_file="$script_dir/release-image-set.sh"
[[ -f "$image_set_file" && ! -L "$image_set_file" ]] || {
  printf 'release image set definition is missing\n' >&2
  exit 1
}
# shellcheck source=release-image-set.sh
source "$image_set_file"

case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    invoking_user="$(id -un)"
    [[ "$invoking_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || {
      printf 'invoking user contains unsafe characters\n' >&2
      exit 1
    }
    script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
    exec sudo -n flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      sudo -u "$invoking_user" -- env OPENBMB_OPERATION_LOCK_HELD=true \
        bash "$script_path" "$@"
    ;;
  true) ;;
  *)
    printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2
    exit 1
    ;;
esac

if [[ $# -ne 5 ]]; then
  printf 'usage: %s <release-id> <delivery-image> <registry-user> <transport-manifest> <host-image-manifest>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

release_id="$1"
delivery_image="$2"
registry_user="$3"
transport_manifest="$4"
host_image_manifest="$5"

[[ "$release_id" =~ ^git-[0-9a-f]{12}$ ]] || {
  printf 'release id must be git- followed by 12 lowercase hexadecimal characters\n' >&2
  exit 1
}
[[ "$delivery_image" =~ ^ghcr\.io/[a-z0-9][a-z0-9._-]*/memory-lighthouse-delivery$ ]] || {
  printf 'delivery image is outside the expected GHCR namespace\n' >&2
  exit 1
}
[[ "$registry_user" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]] || {
  printf 'registry user contains unsafe characters\n' >&2
  exit 1
}
[[ "$transport_manifest" =~ ^openbmb-transport-([0-9a-f]{40})-([0-9]+)-([0-9]+)\.txt$ ]] || {
  printf 'transport manifest name is invalid\n' >&2
  exit 1
}
manifest_source_sha="${BASH_REMATCH[1]}"
manifest_run_id="${BASH_REMATCH[2]}"
manifest_run_attempt="${BASH_REMATCH[3]}"
[[ "git-${manifest_source_sha:0:12}" == "$release_id" ]] || {
  printf 'transport manifest revision differs from release id\n' >&2
  exit 1
}
[[ "$host_image_manifest" =~ ^openbmb-images-([0-9a-f]{40})-([0-9]+)-([0-9]+)\.txt$ ]] || {
  printf 'host image manifest name is invalid\n' >&2
  exit 1
}
[[ "${BASH_REMATCH[1]}" == "$manifest_source_sha" && \
   "${BASH_REMATCH[2]}" == "$manifest_run_id" && \
   "${BASH_REMATCH[3]}" == "$manifest_run_attempt" ]] || {
  printf 'transport and host manifest identities differ\n' >&2
  exit 1
}
[[ -f "$transport_manifest" && ! -L "$transport_manifest" ]] || {
  printf 'transport manifest must be a regular file\n' >&2
  exit 1
}
[[ ! -e "$host_image_manifest" && ! -L "$host_image_manifest" ]] || {
  printf 'host image manifest already exists\n' >&2
  exit 1
}

openbmb_load_release_image_set "$release_id"
required_images=("${OPENBMB_REQUIRED_IMAGES[@]}")
delivery_components=("${OPENBMB_DELIVERY_COMPONENTS[@]}")
[[ "$(wc -l < "$transport_manifest")" -eq "${#required_images[@]}" ]]
awk 'NF != 3 { exit 1 }' "$transport_manifest"

delivery_refs=()
delivery_digests=()
for index in "${!required_images[@]}"; do
  required_image="${required_images[$index]}"
  expected_delivery_ref="$delivery_image:${delivery_components[$index]}-$release_id"
  mapfile -t transport_records < <(
    awk -v image="$required_image" '$1 == image { print $2 " " $3 }' \
      "$transport_manifest"
  )
  [[ "${#transport_records[@]}" -eq 1 ]]
  read -r delivery_ref delivery_digest trailing <<<"${transport_records[0]}"
  [[ "$delivery_ref" == "$expected_delivery_ref" ]]
  [[ "$delivery_digest" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ -z "${trailing:-}" ]]
  delivery_refs+=("$delivery_ref")
  delivery_digests+=("$delivery_digest")
done

host_manifest_tmp=".$host_image_manifest.tmp.$$"
[[ ! -e "$host_manifest_tmp" && ! -L "$host_manifest_tmp" ]]
install -m 0600 /dev/null "$host_manifest_tmp"

auth_dir=''
active_delivery_ref=''
cleanup() {
  local cleanup_status=0
  if [[ -n "$active_delivery_ref" ]]; then
    docker image rm "$active_delivery_ref" >/dev/null 2>&1 || true
  fi
  if [[ -n "$auth_dir" ]]; then
    DOCKER_CONFIG="$auth_dir" docker logout ghcr.io >/dev/null 2>&1 || true
    rm -rf -- "$auth_dir" || cleanup_status=1
  fi
  rm -f -- "$host_manifest_tmp" || cleanup_status=1
  return "$cleanup_status"
}
cleanup_with_status() {
  local status="$1"
  trap - EXIT
  trap '' HUP INT TERM
  if ! cleanup; then
    status=1
  fi
  exit "$status"
}
cleanup_on_exit() {
  local status=$?
  cleanup_with_status "$status"
}
cleanup_on_signal() {
  cleanup_with_status "$1"
}
trap cleanup_on_exit EXIT
trap 'cleanup_on_signal 129' HUP
trap 'cleanup_on_signal 130' INT
trap 'cleanup_on_signal 143' TERM

auth_dir_candidate="$(mktemp -d -- /tmp/openbmb-ghcr-auth.XXXXXX)"
case "$auth_dir_candidate" in
  /tmp/openbmb-ghcr-auth.*) auth_dir="$auth_dir_candidate" ;;
  *) printf 'unexpected Docker authentication directory\n' >&2; exit 1 ;;
esac
chmod 0700 "$auth_dir"

DOCKER_CONFIG="$auth_dir" docker login ghcr.io \
  --username "$registry_user" \
  --password-stdin >/dev/null

pull_with_retry() {
  local image_ref="$1"
  local attempt
  for ((attempt = 1; attempt <= 6; attempt += 1)); do
    if DOCKER_CONFIG="$auth_dir" docker pull "$image_ref"; then
      return 0
    fi
    if [[ "$attempt" -lt 6 ]]; then
      printf 'GHCR pull failed for %s (attempt %s/6); retrying.\n' \
        "$image_ref" "$attempt" >&2
      sleep "$(( attempt * 2 ))"
    fi
  done
  printf 'GHCR pull exhausted retries for %s\n' "$image_ref" >&2
  return 1
}

for index in "${!required_images[@]}"; do
  required_image="${required_images[$index]}"
  active_delivery_ref="${delivery_refs[$index]}@${delivery_digests[$index]}"
  pull_with_retry "$active_delivery_ref"
  pulled_id="$(docker image inspect --format '{{.Id}}' "$active_delivery_ref")"
  [[ "$pulled_id" =~ ^sha256:[0-9a-f]{64}$ ]]
  docker tag "$active_delivery_ref" "$required_image"
  required_id="$(docker image inspect --format '{{.Id}}' "$required_image")"
  [[ "$required_id" == "$pulled_id" ]]
  printf '%s %s\n' "$required_image" "$required_id" >> "$host_manifest_tmp"
  docker image rm "$active_delivery_ref" >/dev/null
  active_delivery_ref=''
done

[[ "$(wc -l < "$host_manifest_tmp")" -eq "${#required_images[@]}" ]]
while read -r image_name image_id trailing; do
  [[ -n "$image_name" && "$image_id" =~ ^sha256:[0-9a-f]{64}$ && -z "${trailing:-}" ]]
done < "$host_manifest_tmp"
mv -- "$host_manifest_tmp" "$host_image_manifest"

printf 'Pulled and retagged %s digest-pinned release images from GHCR.\n' "${#required_images[@]}"
