#!/usr/bin/env bash

# This file is the single version-controlled source for the immutable image set.
# It is intentionally safe both to source and to execute during syntax checks.
# These are existing transport copies from the production anchor, not a new
# mirror. Retain both the registry digest and the containerd image identity.
openbmb_existing_storage_image() {
  OPENBMB_EXISTING_STORAGE_REF=''
  OPENBMB_EXISTING_STORAGE_DIGEST=''
  OPENBMB_EXISTING_STORAGE_ID=''
  case "${1:-}" in
    minio)
      OPENBMB_EXISTING_STORAGE_REF=ghcr.io/sunjianbai/memory-lighthouse-delivery:minio-git-9f4888d29af0
      OPENBMB_EXISTING_STORAGE_DIGEST=sha256:3f97c5651cb6662b880c787a232b6b34fec8d8922e08d6617b25d241a21164bb
      OPENBMB_EXISTING_STORAGE_ID=sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e
      ;;
    minio-mc)
      OPENBMB_EXISTING_STORAGE_REF=ghcr.io/sunjianbai/memory-lighthouse-delivery:minio-mc-git-9f4888d29af0
      OPENBMB_EXISTING_STORAGE_DIGEST=sha256:9ba8cb7340dd57ee994f6e2a8e45bc0dde9d5369615b03c6021105e5b9ce4449
      OPENBMB_EXISTING_STORAGE_ID=sha256:7e3efb09c22c0882fbf341b9d99f61f94ae6c4c20a06f2f1a2b20ea8993d8952
      ;;
    *) return 1 ;;
  esac
}

openbmb_verify_existing_storage_transport() {
  openbmb_existing_storage_image "$1" || return 1
  [[ "$2" == "$OPENBMB_EXISTING_STORAGE_REF" &&
     "$3" == "$OPENBMB_EXISTING_STORAGE_DIGEST" &&
     "$4" == "$OPENBMB_EXISTING_STORAGE_ID" ]]
}

openbmb_load_release_image_set() {
  local release_id="${1:-}"
  [[ "$release_id" =~ ^git-[0-9a-f]{12}$ ]] || {
    printf 'release id must be git- followed by 12 lowercase hexadecimal characters\n' >&2
    return 1
  }

  OPENBMB_REQUIRED_IMAGES=(
    "openbmb-api:$release_id"
    "openbmb-migrator:$release_id"
    "openbmb-client-web:$release_id"
    "openbmb-admin-web:$release_id"
    "openbmb-mysql:$release_id"
    "openbmb-redis:$release_id"
    "openbmb-minio:$release_id"
    "openbmb-minio-mc:$release_id"
    "openbmb-livekit:$release_id"
    "openbmb-clamav:$release_id"
  )
  OPENBMB_SOURCE_IMAGES=(
    "openbmb-api:$release_id"
    "openbmb-migrator:$release_id"
    "openbmb-client-web:$release_id"
    "openbmb-admin-web:$release_id"
    mysql:8.4.8
    redis:7.4.10-alpine
    minio/minio:RELEASE.2025-04-22T22-12-26Z
    minio/mc:RELEASE.2025-04-08T15-39-49Z
    livekit/livekit-server:v1.13.4
    clamav/clamav-debian:1.4.5_base
  )
  OPENBMB_DELIVERY_COMPONENTS=(
    api migrator client-web admin-web mysql redis minio minio-mc livekit clamav
  )
  # The upstream tags above document the original versions. The runner reads
  # the already-existing exact copies; production reuses the same local IDs.
  local index
  for index in 6 7; do
    openbmb_existing_storage_image "${OPENBMB_DELIVERY_COMPONENTS[$index]}"
    OPENBMB_SOURCE_IMAGES[$index]="${OPENBMB_EXISTING_STORAGE_REF%%:*}@$OPENBMB_EXISTING_STORAGE_DIGEST"
  done
  if [[ "${#OPENBMB_REQUIRED_IMAGES[@]}" -ne "${#OPENBMB_SOURCE_IMAGES[@]}" || \
        "${#OPENBMB_REQUIRED_IMAGES[@]}" -ne "${#OPENBMB_DELIVERY_COMPONENTS[@]}" ]]; then
    printf 'release image arrays must have identical lengths\n' >&2
    return 1
  fi
}
