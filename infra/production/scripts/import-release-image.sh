#!/usr/bin/env bash
set -Eeuo pipefail

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    invoking_user="$(id -un)"
    [[ "$invoking_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || {
      printf 'invoking user contains unsafe characters\n' >&2
      exit 1
    }
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

fail() {
  printf 'RELEASE IMAGE IMPORT FAILED: %s\n' "$*" >&2
  exit 1
}

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
transfer_base="$HOME/.openbmb-transfer/direct-v2"
session_base="$transfer_base/sessions"
cache_base="$transfer_base/cache"
[[ "$(dirname -- "$script_dir")" == "$session_base" ]] || \
  fail 'importer must execute from an isolated transfer session'
session_id="$(basename -- "$script_dir")"
[[ "$session_id" =~ ^[0-9]+-[0-9]+$ ]] || fail 'transfer session identity is invalid'
[[ "$(readlink -f -- "$script_dir")" == "$script_dir" ]] || \
  fail 'transfer session is not canonical'

image_set_file="$script_dir/release-image-set.sh"
[[ -f "$image_set_file" && ! -L "$image_set_file" ]] || \
  fail 'release image set definition is missing'
# shellcheck source=release-image-set.sh
source "$image_set_file"

validate_release() {
  release_id="$1"
  source_sha="$2"
  [[ "$release_id" =~ ^git-[0-9a-f]{12}$ ]] || fail 'release id is invalid'
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'source revision is invalid'
  [[ "$release_id" == "git-${source_sha:0:12}" ]] || \
    fail 'release id differs from source revision'
  openbmb_load_release_image_set "$release_id"
}

validate_identity() {
  validate_release "$1" "$2"
  component="$3"
  expected_id="$4"
  [[ "$component" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail 'component is invalid'
  [[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'expected image ID is invalid'

  required_image=''
  application_image=false
  local index
  for index in "${!OPENBMB_DELIVERY_COMPONENTS[@]}"; do
    if [[ "${OPENBMB_DELIVERY_COMPONENTS[$index]}" == "$component" ]]; then
      [[ -z "$required_image" ]] || fail 'component occurs more than once in release image set'
      required_image="${OPENBMB_REQUIRED_IMAGES[$index]}"
    fi
  done
  [[ -n "$required_image" ]] || fail 'component is outside the release image set'
  case "$component" in
    api|migrator|client-web|admin-web) application_image=true ;;
  esac
}

inspect_image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

attest_and_tag_image() {
  local actual_id
  local tagged_id
  local image_revision

  actual_id="$(inspect_image_id "$expected_id")"
  [[ "$actual_id" == "$expected_id" ]] || return 10
  docker tag "$expected_id" "$required_image"
  tagged_id="$(inspect_image_id "$required_image")"
  [[ "$tagged_id" == "$expected_id" ]] || fail "tagged image identity differs for $component"
  if [[ "$application_image" == true ]]; then
    image_revision="$(
      docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$required_image"
    )"
    [[ "$image_revision" == "$source_sha" ]] || \
      fail "OCI revision differs for $component"
  fi
}

validate_regular_owned_file() {
  local path="$1"
  local invoking_user
  invoking_user="$(id -un)"
  [[ -f "$path" && ! -L "$path" ]] || fail "not a regular transfer file: $path"
  [[ "$(stat -c %U "$path")" == "$invoking_user" ]] || \
    fail "transfer file is not owned by the invoking user: $path"
}

docker_free_kib() {
  local docker_root
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  [[ "$docker_root" == /* ]] || fail 'Docker root is not absolute'
  df -Pk "$docker_root" | awk 'NR == 2 { print $4 }'
}

prepare_expected_manifest() {
  validate_release "$1" "$2"
  expected_manifest_name="$3"
  expected_manifest_sha256="$4"
  [[ "$expected_manifest_name" =~ ^expected-images-([0-9a-f]{40})-([0-9]+)-([0-9]+)\.txt$ ]] || \
    fail 'expected manifest name is invalid'
  [[ "${BASH_REMATCH[1]}" == "$source_sha" && \
     "${BASH_REMATCH[2]}-${BASH_REMATCH[3]}" == "$session_id" ]] || \
    fail 'expected manifest identity differs from the transfer session'
  [[ "$expected_manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || \
    fail 'expected manifest digest is invalid'
  expected_manifest="$script_dir/$expected_manifest_name"
  validate_regular_owned_file "$expected_manifest"
  printf '%s  %s\n' "$expected_manifest_sha256" "$expected_manifest" | \
    sha256sum --check --status || fail 'expected manifest digest differs'
  [[ "$(wc -l < "$expected_manifest")" -eq "${#OPENBMB_REQUIRED_IMAGES[@]}" ]] || \
    fail 'expected manifest image count differs from release image set'
  awk 'NF != 2 { exit 1 }' "$expected_manifest" || \
    fail 'expected manifest entries must contain an image name and ID'
}

attest_expected_manifest() {
  local output_file="$1"
  local index
  local image_name
  local status
  local -a manifest_ids
  : > "$output_file"
  for index in "${!OPENBMB_REQUIRED_IMAGES[@]}"; do
    image_name="${OPENBMB_REQUIRED_IMAGES[$index]}"
    component="${OPENBMB_DELIVERY_COMPONENTS[$index]}"
    mapfile -t manifest_ids < <(
      awk -v image="$image_name" '$1 == image { print $2 }' "$expected_manifest"
    )
    [[ "${#manifest_ids[@]}" -eq 1 ]] || \
      fail "expected manifest must contain exactly one entry for $image_name"
    expected_id="${manifest_ids[0]}"
    validate_identity "$release_id" "$source_sha" "$component" "$expected_id"
    if attest_and_tag_image; then
      :
    else
      status=$?
      [[ "$status" -ne 10 ]] || fail "final image identity differs for $component"
      exit "$status"
    fi
    printf '%s %s\n' "$image_name" "$expected_id" >> "$output_file"
  done
}

cleanup_release_cache() {
  local release_cache="$cache_base/$release_id"
  local component_dir
  local component_name
  local archive_dir
  local archive_name
  local transfer_file
  local transfer_name
  local known_component

  if [[ ! -e "$release_cache" && ! -L "$release_cache" ]]; then
    return
  fi
  [[ -d "$release_cache" && ! -L "$release_cache" ]] || \
    fail 'release cache is not a regular directory'
  [[ "$(readlink -f -- "$release_cache")" == "$release_cache" ]] || \
    fail 'release cache is not canonical'
  shopt -s nullglob dotglob
  for component_dir in "$release_cache"/*; do
    component_name="$(basename -- "$component_dir")"
    known_component=false
    for component in "${OPENBMB_DELIVERY_COMPONENTS[@]}"; do
      if [[ "$component_name" == "$component" ]]; then
        known_component=true
      fi
    done
    [[ "$known_component" == true ]] || fail 'release cache contains an unknown component'
    [[ -d "$component_dir" && ! -L "$component_dir" ]] || \
      fail 'component cache is not a regular directory'
    for archive_dir in "$component_dir"/*; do
      archive_name="$(basename -- "$archive_dir")"
      [[ "$archive_name" =~ ^[0-9a-f]{64}$ ]] || fail 'cache archive name is invalid'
      [[ -d "$archive_dir" && ! -L "$archive_dir" ]] || \
        fail 'archive cache is not a regular directory'
      for transfer_file in "$archive_dir"/*; do
        transfer_name="$(basename -- "$transfer_file")"
        [[ -f "$transfer_file" && ! -L "$transfer_file" ]] || \
          fail 'archive cache contains a non-file entry'
        [[ "$transfer_name" == chunks.manifest || \
           "$transfer_name" =~ ^chunks\.manifest\.incoming-[0-9]+-[0-9]+$ || \
           "$transfer_name" =~ ^part-[0-9]{6}$ || \
           "$transfer_name" =~ ^part-[0-9]{6}\.partial-[0-9]+-[0-9]+$ ]] || \
          fail 'archive cache contains an unexpected file'
      done
    done
  done

  for component_dir in "$release_cache"/*; do
    for archive_dir in "$component_dir"/*; do
      find "$archive_dir" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir -- "$archive_dir"
    done
    rmdir -- "$component_dir"
  done
  rmdir -- "$release_cache"
  rmdir -- "$cache_base" 2>/dev/null || true
}

mode="${1:-}"
case "$mode" in
  probe)
    [[ $# -eq 5 ]] || fail 'probe expects release id, source revision, component, and image ID'
    validate_identity "$2" "$3" "$4" "$5"
    if attest_and_tag_image; then
      printf 'present\n'
      exit 0
    else
      status=$?
    fi
    [[ "$status" -eq 10 ]] || exit "$status"
    printf 'missing\n'
    exit 10
    ;;

  import)
    [[ $# -eq 10 ]] || fail 'import argument count is invalid'
    validate_identity "$2" "$3" "$4" "$5"
    archive_sha256="$6"
    raw_bytes="$7"
    compressed_bytes="$8"
    chunk_manifest_name="$9"
    chunk_manifest_sha256="${10}"

    [[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'archive digest is invalid'
    [[ "$raw_bytes" =~ ^[1-9][0-9]*$ ]] || fail 'raw archive size is invalid'
    [[ "$compressed_bytes" =~ ^[1-9][0-9]*$ ]] || fail 'compressed archive size is invalid'
    [[ "$chunk_manifest_name" == chunks.manifest ]] || fail 'chunk manifest name is invalid'
    [[ "$chunk_manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || \
      fail 'chunk manifest digest is invalid'

    archive_dir="$cache_base/$release_id/$component/$archive_sha256"
    chunk_manifest="$archive_dir/$chunk_manifest_name"
    [[ -d "$archive_dir" && ! -L "$archive_dir" ]] || fail 'archive directory is missing'
    [[ "$(readlink -f -- "$archive_dir")" == "$archive_dir" ]] || \
      fail 'archive directory is not canonical'
    validate_regular_owned_file "$chunk_manifest"
    printf '%s  %s\n' "$chunk_manifest_sha256" "$chunk_manifest" | \
      sha256sum --check --status || fail 'chunk manifest digest differs'

    chunk_paths=()
    chunk_total_bytes=0
    expected_suffix=0
    while read -r chunk_sha256 chunk_bytes chunk_name trailing; do
      [[ "$chunk_sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'chunk digest is invalid'
      [[ "$chunk_bytes" =~ ^[1-9][0-9]*$ ]] || fail 'chunk size is invalid'
      [[ "$chunk_name" =~ ^part-([0-9]{6})$ ]] || fail 'chunk name is invalid'
      [[ -z "${trailing:-}" ]] || fail 'chunk manifest entry has trailing fields'
      chunk_suffix=$((10#${BASH_REMATCH[1]}))
      [[ "$chunk_suffix" -eq "$expected_suffix" ]] || fail 'chunk sequence is incomplete or duplicated'
      expected_suffix=$((expected_suffix + 1))
      chunk_path="$archive_dir/$chunk_name"
      validate_regular_owned_file "$chunk_path"
      [[ "$(stat -c %s "$chunk_path")" -eq "$chunk_bytes" ]] || \
        fail "chunk size differs: $chunk_name"
      printf '%s  %s\n' "$chunk_sha256" "$chunk_path" | \
        sha256sum --check --status || fail "chunk digest differs: $chunk_name"
      chunk_paths+=("$chunk_path")
      chunk_total_bytes=$((chunk_total_bytes + chunk_bytes))
    done < "$chunk_manifest"
    [[ "${#chunk_paths[@]}" -gt 0 ]] || fail 'chunk manifest is empty'
    [[ "$chunk_total_bytes" -eq "$compressed_bytes" ]] || \
      fail 'compressed archive size differs from chunk manifest'

    actual_archive_sha256="$(cat -- "${chunk_paths[@]}" | sha256sum | awk '{ print $1 }')"
    [[ "$actual_archive_sha256" == "$archive_sha256" ]] || \
      fail 'compressed archive digest differs'

    minimum_free_kib=4194304
    raw_kib=$(((raw_bytes + 1023) / 1024))
    free_before_kib="$(docker_free_kib)"
    [[ "$free_before_kib" =~ ^[0-9]+$ ]] || fail 'Docker free-space reading is invalid'
    [[ "$free_before_kib" -ge $((minimum_free_kib + raw_kib)) ]] || \
      fail 'insufficient Docker disk space to import while retaining 4 GiB free'

    if ! cat -- "${chunk_paths[@]}" | gzip -dc | docker load >/dev/null; then
      fail "docker load failed for $component"
    fi
    if attest_and_tag_image; then
      :
    else
      status=$?
      [[ "$status" -ne 10 ]] || fail "loaded image ID differs for $component"
      exit "$status"
    fi

    find "$archive_dir" -mindepth 1 -maxdepth 1 -type f -delete
    rmdir -- "$archive_dir"
    rmdir -- "$cache_base/$release_id/$component" 2>/dev/null || true
    rmdir -- "$cache_base/$release_id" 2>/dev/null || true
    free_after_kib="$(docker_free_kib)"
    [[ "$free_after_kib" =~ ^[0-9]+$ ]] || fail 'post-import Docker free-space reading is invalid'
    [[ "$free_after_kib" -ge "$minimum_free_kib" ]] || \
      fail 'Docker free space fell below 4 GiB after transfer cleanup'
    printf 'imported\n'
    ;;

  finalize)
    [[ $# -eq 6 ]] || fail 'finalize argument count is invalid'
    prepare_expected_manifest "$2" "$3" "$4" "$5"
    host_manifest_name="$6"
    [[ "$host_manifest_name" =~ ^openbmb-images-[0-9a-f]{40}-[0-9]+-[0-9]+\.txt$ ]] || \
      fail 'host manifest name is invalid'
    [[ "${expected_manifest_name#expected-images-}" == "${host_manifest_name#openbmb-images-}" ]] || \
      fail 'expected and host manifest identities differ'
    host_manifest="$script_dir/$host_manifest_name"

    host_manifest_exists=false
    if [[ -e "$host_manifest" || -L "$host_manifest" ]]; then
      validate_regular_owned_file "$host_manifest"
      cmp --silent "$expected_manifest" "$host_manifest" || \
        fail 'host manifest already exists with different identities'
      host_manifest_exists=true
    fi

    host_manifest_tmp=".$host_manifest_name.tmp.$$"
    [[ ! -e "$script_dir/$host_manifest_tmp" && ! -L "$script_dir/$host_manifest_tmp" ]] || \
      fail 'temporary host manifest already exists'
    install -m 0600 /dev/null "$script_dir/$host_manifest_tmp"
    cleanup_finalize() {
      rm -f -- "$script_dir/$host_manifest_tmp"
    }
    trap cleanup_finalize EXIT
    attest_expected_manifest "$script_dir/$host_manifest_tmp"

    if [[ "$host_manifest_exists" == true ]]; then
      cmp --silent "$script_dir/$host_manifest_tmp" "$host_manifest" || \
        fail 'reattested image identities differ from the existing host manifest'
      rm -f -- "$script_dir/$host_manifest_tmp"
    else
      mv -- "$script_dir/$host_manifest_tmp" "$host_manifest"
    fi
    trap - EXIT
    printf 'finalized\n'
    ;;

  cleanup)
    [[ $# -eq 5 ]] || fail 'cleanup argument count is invalid'
    prepare_expected_manifest "$2" "$3" "$4" "$5"
    attest_expected_manifest /dev/null
    cleanup_release_cache
    printf 'cleaned\n'
    ;;

  *)
    printf 'usage: %s {probe|import|finalize|cleanup} ...\n' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac
