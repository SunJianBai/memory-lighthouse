#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
umask 077

readonly stale_minutes=1440
readonly cleanup_limit=8

usage() {
  printf 'usage: prepare-remote-incoming.sh api|web <incoming-root> <target> <required-available-bytes>\n' >&2
  exit 64
}

[[ "$#" -eq 4 ]] || usage
component="$1"
incoming_root="$2"
target="$3"
required_bytes="$4"

[[ "$component" =~ ^(api|web)$ ]] || usage
[[ "$required_bytes" =~ ^[1-9][0-9]*$ ]] || usage
[[ "$HOME" == /home/ubuntu ]] || {
  printf 'incoming preparation must run as the ubuntu deployment account\n' >&2
  exit 69
}

case "$component" in
  api)
    [[ "$incoming_root" == /home/ubuntu/.openbmb-api-incoming ]]
    [[ "$(dirname -- "$target")" == "$incoming_root" ]]
    [[ "$(basename -- "$target")" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]]
    ;;
  web)
    [[ "$incoming_root" == /home/ubuntu/.openbmb-web-incoming ]]
    [[ "$(dirname -- "$target")" == "$incoming_root" ]]
    [[ "$(basename -- "$target")" =~ ^openbmb-web-[0-9a-f]{40}-[0-9a-f]{64}-([0-9]+-[0-9]+|[0-9a-f]{32})\.tar\.zst$ ]]
    ;;
esac

[[ ! -L "$incoming_root" ]] || {
  printf 'incoming root must not be a symbolic link\n' >&2
  exit 65
}
mkdir -p -- "$incoming_root"
[[ -d "$incoming_root" && ! -L "$incoming_root" ]] || exit 65
deployment_uid="$(id -u)"
[[ "$(stat -c %u -- "$incoming_root")" == "$deployment_uid" ]] || {
  printf 'incoming root has an unexpected owner\n' >&2
  exit 65
}
chmod 0700 -- "$incoming_root"

is_old() {
  [[ -n "$(find "$1" -maxdepth 0 -mmin "+$stale_minutes" -print -quit)" ]]
}

cleanup_api_directory() {
  local candidate="$1" base="$2" source_sha prefix archive sidecar path
  [[ "$base" =~ ^([0-9a-f]{40})-[0-9]+-[0-9]+$ ]] || return 1
  source_sha="${BASH_REMATCH[1]}"
  prefix="${source_sha:0:12}"
  archive="$candidate/openbmb-native-api-git-$prefix.tar.gz"
  sidecar="$archive.sha256"
  [[ -d "$candidate" && ! -L "$candidate" ]] || return 1
  [[ "$(stat -c %u -- "$candidate")" == "$deployment_uid" ]] || return 1
  is_old "$candidate" || return 1

  local -a members=()
  mapfile -d '' -t members < <(find "$candidate" -mindepth 1 -maxdepth 1 -print0)
  (( ${#members[@]} <= 2 )) || return 1
  for path in "${members[@]}"; do
    [[ "$path" == "$archive" || "$path" == "$sidecar" ]] || return 1
    [[ -f "$path" && ! -L "$path" ]] || return 1
    [[ "$(stat -c %u -- "$path")" =~ ^(0|$deployment_uid)$ ]] || return 1
    is_old "$path" || return 1
  done
  for path in "$archive" "$sidecar"; do
    [[ ! -e "$path" && ! -L "$path" ]] || rm -f -- "$path"
  done
  rmdir -- "$candidate"
}

cleanup_web_archive() {
  local candidate="$1" base="$2"
  [[ "$base" =~ ^openbmb-web-[0-9a-f]{40}-[0-9a-f]{64}-([0-9]+-[0-9]+|[0-9a-f]{32})\.tar\.zst$ ]] || return 1
  [[ -f "$candidate" && ! -L "$candidate" ]] || return 1
  [[ "$(stat -c %u -- "$candidate")" == "$deployment_uid" ]] || return 1
  is_old "$candidate" || return 1
  rm -f -- "$candidate"
}

cleaned=0
while IFS= read -r -d '' candidate; do
  (( cleaned < cleanup_limit )) || break
  base="$(basename -- "$candidate")"
  if [[ "$component" == api ]]; then
    cleanup_api_directory "$candidate" "$base" || continue
  else
    cleanup_web_archive "$candidate" "$base" || continue
  fi
  (( cleaned += 1 ))
done < <(find "$incoming_root" -mindepth 1 -maxdepth 1 \
  -mmin "+$stale_minutes" -print0 | sort -z)

[[ ! -e "$target" && ! -L "$target" ]] || {
  printf 'run-specific incoming target already exists\n' >&2
  exit 73
}
if [[ "$component" == api ]]; then
  mkdir -- "$target"
  chmod 0700 -- "$target"
  [[ -d "$target" && ! -L "$target" && "$(stat -c %u -- "$target")" == "$deployment_uid" ]]
fi

available_bytes="$(df -P -B1 "$incoming_root" | awk 'NR == 2 { print $4 }')"
[[ "$available_bytes" =~ ^[0-9]+$ ]] || {
  printf 'could not determine available filesystem capacity\n' >&2
  exit 69
}
(( available_bytes >= required_bytes )) || {
  printf 'insufficient disk before upload: available=%s required=%s\n' \
    "$available_bytes" "$required_bytes" >&2
  exit 75
}

printf 'Incoming root ready; removed=%d available=%s required=%s\n' \
  "$cleaned" "$available_bytes" "$required_bytes"
