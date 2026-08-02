#!/usr/bin/env bash

# This file is the single version-controlled source for the immutable image set.
# It is intentionally safe both to source and to execute during syntax checks.
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
  if [[ "${#OPENBMB_REQUIRED_IMAGES[@]}" -ne "${#OPENBMB_SOURCE_IMAGES[@]}" || \
        "${#OPENBMB_REQUIRED_IMAGES[@]}" -ne "${#OPENBMB_DELIVERY_COMPONENTS[@]}" ]]; then
    printf 'release image arrays must have identical lengths\n' >&2
    return 1
  fi
}
