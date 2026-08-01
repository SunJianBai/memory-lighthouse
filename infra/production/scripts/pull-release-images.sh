#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  printf 'usage: %s <release-id> <delivery-image> <registry-user>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

release_id="$1"
delivery_image="$2"
registry_user="$3"

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

auth_dir="$(mktemp -d -- /tmp/openbmb-ghcr-auth.XXXXXX)"
case "$auth_dir" in
  /tmp/openbmb-ghcr-auth.*) ;;
  *) printf 'unexpected Docker authentication directory\n' >&2; exit 1 ;;
esac
chmod 0700 "$auth_dir"

cleanup() {
  DOCKER_CONFIG="$auth_dir" docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf -- "$auth_dir"
}
trap cleanup EXIT

DOCKER_CONFIG="$auth_dir" docker login ghcr.io \
  --username "$registry_user" \
  --password-stdin >/dev/null

required_images=(
  "openbmb-api:$release_id"
  "openbmb-migrator:$release_id"
  "openbmb-client-web:$release_id"
  "openbmb-admin-web:$release_id"
  mysql:8.4.8
  redis:7.4.10-alpine
  minio/minio:RELEASE.2025-04-22T22-12-26Z
  minio/mc:RELEASE.2025-04-08T15-39-49Z
  livekit/livekit-server:v1.13.4
)
delivery_components=(
  api migrator client-web admin-web mysql redis minio minio-mc livekit
)
[[ "${#required_images[@]}" -eq "${#delivery_components[@]}" ]]

for index in "${!required_images[@]}"; do
  required_image="${required_images[$index]}"
  delivery_ref="$delivery_image:${delivery_components[$index]}-$release_id"
  DOCKER_CONFIG="$auth_dir" docker pull "$delivery_ref"
  pulled_id="$(docker image inspect --format '{{.Id}}' "$delivery_ref")"
  [[ "$pulled_id" =~ ^sha256:[0-9a-f]{64}$ ]]
  docker tag "$delivery_ref" "$required_image"
  required_id="$(docker image inspect --format '{{.Id}}' "$required_image")"
  [[ "$required_id" == "$pulled_id" ]]
  docker image rm "$delivery_ref" >/dev/null
done

printf 'Pulled and retagged %s exact release images from GHCR.\n' "${#required_images[@]}"
