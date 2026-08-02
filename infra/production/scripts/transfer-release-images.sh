#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 6 ]]; then
  printf 'usage: %s <release-id> <source-sha> <run-id> <run-attempt> <ssh-host> <host-image-manifest>\n' \
    "${BASH_SOURCE[0]}" >&2
  exit 2
fi

release_id="$1"
source_sha="$2"
run_id="$3"
run_attempt="$4"
ssh_host="$5"
host_image_manifest="$6"

[[ "$release_id" =~ ^git-[0-9a-f]{12}$ ]] || {
  printf 'release id is invalid\n' >&2
  exit 1
}
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'source revision is invalid\n' >&2
  exit 1
}
[[ "$release_id" == "git-${source_sha:0:12}" ]] || {
  printf 'release id differs from source revision\n' >&2
  exit 1
}
[[ "$run_id" =~ ^[0-9]+$ && "$run_attempt" =~ ^[0-9]+$ ]] || {
  printf 'workflow run identity is invalid\n' >&2
  exit 1
}
[[ "$ssh_host" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  printf 'SSH host alias is invalid\n' >&2
  exit 1
}

manifest_name="$(basename -- "$host_image_manifest")"
expected_manifest_name="expected-images-$source_sha-$run_id-$run_attempt.txt"
[[ "$manifest_name" == "openbmb-images-$source_sha-$run_id-$run_attempt.txt" ]] || {
  printf 'host image manifest name is invalid\n' >&2
  exit 1
}
[[ -d "$(dirname -- "$host_image_manifest")" ]] || {
  printf 'host image manifest parent is missing\n' >&2
  exit 1
}
[[ ! -e "$host_image_manifest" && ! -L "$host_image_manifest" ]] || {
  printf 'host image manifest already exists\n' >&2
  exit 1
}

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
image_set_file="$script_dir/release-image-set.sh"
importer_file="$script_dir/import-release-image.sh"
[[ -f "$image_set_file" && ! -L "$image_set_file" ]] || {
  printf 'release image set definition is missing\n' >&2
  exit 1
}
[[ -f "$importer_file" && ! -L "$importer_file" ]] || {
  printf 'release image importer is missing\n' >&2
  exit 1
}
# shellcheck source=release-image-set.sh
source "$image_set_file"
openbmb_load_release_image_set "$release_id"

runner_temp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
[[ -d "$runner_temp" && ! -L "$runner_temp" ]] || {
  printf 'runner temporary directory is invalid\n' >&2
  exit 1
}
local_transfer_dir="$(mktemp -d -- "$runner_temp/openbmb-image-transfer.XXXXXX")"
case "$local_transfer_dir" in
  "$runner_temp"/openbmb-image-transfer.*) ;;
  *) printf 'unsafe local transfer directory\n' >&2; exit 1 ;;
esac

ssh_command="$(command -v ssh)"
scp_command="$(command -v scp)"
[[ "$ssh_command" == /* && "$scp_command" == /* ]] || {
  printf 'SSH/SCP command paths must be absolute\n' >&2
  exit 1
}
transfer_lock_pid=''
transfer_lock_read_fd=''
transfer_lock_monitor_fd=''
transfer_lock_write_fd=''
transfer_lock_watcher_pid=''
cleanup_local() {
  local status=$?
  trap - EXIT HUP INT TERM
  rm -rf -- "$local_transfer_dir"
  if [[ -n "$transfer_lock_watcher_pid" ]]; then
    kill "$transfer_lock_watcher_pid" >/dev/null 2>&1 || true
    wait "$transfer_lock_watcher_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$transfer_lock_read_fd" ]]; then
    exec {transfer_lock_read_fd}<&- 2>/dev/null || true
  fi
  if [[ -n "$transfer_lock_monitor_fd" ]]; then
    exec {transfer_lock_monitor_fd}<&- 2>/dev/null || true
  fi
  if [[ -n "$transfer_lock_write_fd" ]]; then
    exec {transfer_lock_write_fd}>&- 2>/dev/null || true
  fi
  if [[ -n "$transfer_lock_pid" ]]; then
    if ! wait "$transfer_lock_pid" && [[ "$status" -eq 0 ]]; then
      status=1
    fi
  fi
  exit "$status"
}
trap cleanup_local EXIT

# Keep a distinct transfer lease for all metadata/chunk writes. Docker tag/load and
# final attestation additionally take the production operation lock in the importer.
coproc OPENBMB_TRANSFER_LOCK {
  "$ssh_command" "$ssh_host" \
    'set -euo pipefail
     invoking_user="$(id -un)"
     [[ "$invoking_user" =~ ^[a-z_][a-z0-9_-]*$ ]]
     exec sudo -n flock --exclusive --wait 0 --conflict-exit-code 75 \
       /run/lock/openbmb-image-transfer.lock \
       sudo -u "$invoking_user" -- bash -c '\''printf "locked\n"; cat >/dev/null'\'''
}
transfer_lock_pid="$OPENBMB_TRANSFER_LOCK_PID"
transfer_lock_read_fd="${OPENBMB_TRANSFER_LOCK[0]}"
transfer_lock_write_fd="${OPENBMB_TRANSFER_LOCK[1]}"
if ! IFS= read -r transfer_lock_ready <&"$transfer_lock_read_fd"; then
  printf 'failed to acquire the remote image-transfer lease\n' >&2
  exit 1
fi
[[ "$transfer_lock_ready" == locked ]] || {
  printf 'remote image-transfer lease returned an invalid handshake\n' >&2
  exit 1
}
exec {transfer_lock_monitor_fd}<&"$transfer_lock_read_fd"
exec {transfer_lock_read_fd}<&-
transfer_lock_read_fd=''

transfer_owner_pid="$BASHPID"
(
  set +e
  while IFS= read -r _unexpected_lock_output <&"$transfer_lock_monitor_fd"; do :; done
  kill -TERM "$transfer_owner_pid" >/dev/null 2>&1
) &
transfer_lock_watcher_pid=$!
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

assert_transfer_lock_alive() {
  if [[ -z "$transfer_lock_pid" ]] || ! kill -0 "$transfer_lock_pid" 2>/dev/null; then
    printf 'remote image-transfer lease was lost; refusing further cache writes\n' >&2
    exit 1
  fi
}

ssh() {
  local command_status=0
  assert_transfer_lock_alive
  "$ssh_command" "$@" || command_status=$?
  assert_transfer_lock_alive
  return "$command_status"
}

scp() {
  local command_status=0
  assert_transfer_lock_alive
  "$scp_command" "$@" || command_status=$?
  assert_transfer_lock_alive
  return "$command_status"
}

assert_transfer_lock_alive

expected_manifest="$local_transfer_dir/$expected_manifest_name"
install -m 0600 /dev/null "$expected_manifest"
for image_name in "${OPENBMB_REQUIRED_IMAGES[@]}"; do
  image_id="$(docker image inspect --format '{{.Id}}' "$image_name")"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    printf 'runner image ID is invalid for %s\n' "$image_name" >&2
    exit 1
  }
  printf '%s %s\n' "$image_name" "$image_id" >> "$expected_manifest"
done
expected_manifest_sha256="$(sha256sum "$expected_manifest" | awk '{ print $1 }')"
[[ "$expected_manifest_sha256" =~ ^[0-9a-f]{64}$ ]]

session_id="$run_id-$run_attempt"
remote_base=".openbmb-transfer/direct-v2"
remote_session="$remote_base/sessions/$session_id"
remote_release_cache="$remote_base/cache/$release_id"
importer_sha256="$(sha256sum "$importer_file" | awk '{ print $1 }')"
image_set_sha256="$(sha256sum "$image_set_file" | awk '{ print $1 }')"
importer_incoming="import-release-image.sh.incoming-$session_id"
image_set_incoming="release-image-set.sh.incoming-$session_id"
expected_incoming="$expected_manifest_name.incoming"

ssh "$ssh_host" \
  "set -euo pipefail
   base=\"\$HOME/$remote_base\"
   sessions=\"\$base/sessions\"
   cache=\"\$base/cache\"
   session=\"\$sessions/$session_id\"
   install -d -m 0700 \"\$HOME/.openbmb-transfer\" \"\$base\" \"\$sessions\" \"\$cache\"
   for path in \"\$HOME/.openbmb-transfer\" \"\$base\" \"\$sessions\" \"\$cache\"; do
     test -d \"\$path\" && test ! -L \"\$path\"
   done
   if test -e \"\$session\" || test -L \"\$session\"; then
     test -d \"\$session\" && test ! -L \"\$session\"
   else
     install -d -m 0700 \"\$session\"
   fi
   test \"\$(readlink -f -- \"\$session\")\" = \"\$session\"
   rm -f -- \"\$session/$importer_incoming\" \"\$session/$image_set_incoming\" \"\$session/$expected_incoming\""

scp "$importer_file" "$ssh_host:$remote_session/$importer_incoming"
scp "$image_set_file" "$ssh_host:$remote_session/$image_set_incoming"
scp "$expected_manifest" "$ssh_host:$remote_session/$expected_incoming"

ssh "$ssh_host" \
  "set -euo pipefail
   session=\"\$HOME/$remote_session\"
   printf '%s  %s\\n' '$importer_sha256' \"\$session/$importer_incoming\" | sha256sum --check --status
   printf '%s  %s\\n' '$image_set_sha256' \"\$session/$image_set_incoming\" | sha256sum --check --status
   printf '%s  %s\\n' '$expected_manifest_sha256' \"\$session/$expected_incoming\" | sha256sum --check --status
   chmod 0700 \"\$session/$importer_incoming\"
   chmod 0600 \"\$session/$image_set_incoming\" \"\$session/$expected_incoming\"
   mv -f -- \"\$session/$importer_incoming\" \"\$session/import-release-image.sh\"
   mv -f -- \"\$session/$image_set_incoming\" \"\$session/release-image-set.sh\"
   mv -f -- \"\$session/$expected_incoming\" \"\$session/$expected_manifest_name\""

for index in "${!OPENBMB_REQUIRED_IMAGES[@]}"; do
  image_name="${OPENBMB_REQUIRED_IMAGES[$index]}"
  component="${OPENBMB_DELIVERY_COMPONENTS[$index]}"
  expected_id="$(awk -v image="$image_name" '$1 == image { print $2 }' "$expected_manifest")"
  [[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]]

  set +e
  probe_output="$(
    ssh "$ssh_host" \
      "cd \"\$HOME/$remote_session\" && bash ./import-release-image.sh probe '$release_id' '$source_sha' '$component' '$expected_id'"
  )"
  probe_status=$?
  set -e
  if [[ "$probe_status" -eq 0 ]]; then
    [[ "$probe_output" == present ]]
    printf 'Reused exact image ID for %s.\n' "$image_name"
    continue
  fi
  [[ "$probe_status" -eq 10 && "$probe_output" == missing ]] || exit "$probe_status"

  image_transfer_dir="$local_transfer_dir/$component"
  chunks_dir="$image_transfer_dir/chunks"
  install -d -m 0700 "$chunks_dir"
  raw_archive="$image_transfer_dir/image.tar"
  docker save --output "$raw_archive" "$image_name"
  raw_bytes="$(stat -c %s "$raw_archive")"
  [[ "$raw_bytes" =~ ^[1-9][0-9]*$ ]]
  gzip -1 -n -- "$raw_archive"
  compressed_archive="$raw_archive.gz"
  compressed_bytes="$(stat -c %s "$compressed_archive")"
  archive_sha256="$(sha256sum "$compressed_archive" | awk '{ print $1 }')"
  [[ "$compressed_bytes" =~ ^[1-9][0-9]*$ && "$archive_sha256" =~ ^[0-9a-f]{64}$ ]]
  split --bytes=32M --numeric-suffixes=0 --suffix-length=6 \
    "$compressed_archive" "$chunks_dir/part-"
  rm -f -- "$compressed_archive"

  chunk_manifest="$image_transfer_dir/chunks.manifest"
  install -m 0600 /dev/null "$chunk_manifest"
  for chunk_path in "$chunks_dir"/part-*; do
    chunk_name="$(basename -- "$chunk_path")"
    [[ "$chunk_name" =~ ^part-[0-9]{6}$ ]]
    chunk_sha256="$(sha256sum "$chunk_path" | awk '{ print $1 }')"
    chunk_bytes="$(stat -c %s "$chunk_path")"
    [[ "$chunk_sha256" =~ ^[0-9a-f]{64}$ && "$chunk_bytes" =~ ^[1-9][0-9]*$ ]]
    printf '%s %s %s\n' "$chunk_sha256" "$chunk_bytes" "$chunk_name" >> "$chunk_manifest"
  done
  chunk_manifest_sha256="$(sha256sum "$chunk_manifest" | awk '{ print $1 }')"
  [[ "$chunk_manifest_sha256" =~ ^[0-9a-f]{64}$ ]]

  remote_archive_dir="$remote_release_cache/$component/$archive_sha256"
  remote_manifest_incoming="chunks.manifest.incoming-$session_id"
  ssh "$ssh_host" \
    "set -euo pipefail
     release_cache=\"\$HOME/$remote_release_cache\"
     component_dir=\"\$release_cache/$component\"
     archive_dir=\"\$component_dir/$archive_sha256\"
     install -d -m 0700 \"\$release_cache\"
     test -d \"\$release_cache\" && test ! -L \"\$release_cache\"
     if test -e \"\$component_dir\" || test -L \"\$component_dir\"; then
       test -d \"\$component_dir\" && test ! -L \"\$component_dir\"
     else
       install -d -m 0700 \"\$component_dir\"
     fi
     if test -e \"\$archive_dir\" || test -L \"\$archive_dir\"; then
       test -d \"\$archive_dir\" && test ! -L \"\$archive_dir\"
     else
       install -d -m 0700 \"\$archive_dir\"
     fi
     test \"\$(readlink -f -- \"\$archive_dir\")\" = \"\$archive_dir\"
     if test -f \"\$archive_dir/chunks.manifest\" && test ! -L \"\$archive_dir/chunks.manifest\" &&
        printf '%s  %s\\n' '$chunk_manifest_sha256' \"\$archive_dir/chunks.manifest\" | sha256sum --check --status; then
       :
     else
       test -z \"\$(find \"\$archive_dir\" -mindepth 1 -maxdepth 1 ! -type f -print -quit)\"
       find \"\$archive_dir\" -mindepth 1 -maxdepth 1 -type f -delete
     fi
     rm -f -- \"\$archive_dir/$remote_manifest_incoming\""
  scp "$chunk_manifest" "$ssh_host:$remote_archive_dir/$remote_manifest_incoming"
  ssh "$ssh_host" \
    "set -euo pipefail
     archive_dir=\"\$HOME/$remote_archive_dir\"
     printf '%s  %s\\n' '$chunk_manifest_sha256' \"\$archive_dir/$remote_manifest_incoming\" | sha256sum --check --status
     chmod 0600 \"\$archive_dir/$remote_manifest_incoming\"
     mv -f -- \"\$archive_dir/$remote_manifest_incoming\" \"\$archive_dir/chunks.manifest\""

  missing_chunks="$image_transfer_dir/missing-chunks.txt"
  install -m 0600 /dev/null "$missing_chunks"
  missing_chunk_bytes=0
  while read -r chunk_sha256 chunk_bytes chunk_name trailing; do
    [[ "$chunk_sha256" =~ ^[0-9a-f]{64}$ ]]
    [[ "$chunk_bytes" =~ ^[1-9][0-9]*$ ]]
    [[ "$chunk_name" =~ ^part-[0-9]{6}$ && -z "${trailing:-}" ]]
    remote_chunk="$remote_archive_dir/$chunk_name"
    set +e
    ssh "$ssh_host" \
      "set -euo pipefail
       path=\"\$HOME/$remote_chunk\"
       if test -f \"\$path\" && test ! -L \"\$path\" &&
          test \"\$(stat -c %s \"\$path\")\" -eq '$chunk_bytes' &&
          printf '%s  %s\\n' '$chunk_sha256' \"\$path\" | sha256sum --check --status; then
         exit 0
       fi
       rm -f -- \"\$path\"
       exit 10"
    chunk_status=$?
    set -e
    if [[ "$chunk_status" -eq 0 ]]; then
      printf 'Reused verified chunk %s/%s.\n' "$component" "$chunk_name"
    elif [[ "$chunk_status" -eq 10 ]]; then
      printf '%s\n' "$chunk_name" >> "$missing_chunks"
      missing_chunk_bytes=$((missing_chunk_bytes + chunk_bytes))
    else
      exit "$chunk_status"
    fi
  done < "$chunk_manifest"

  required_kib=$((4194304 + (raw_bytes + 1023) / 1024 + (missing_chunk_bytes + 1023) / 1024))
  ssh "$ssh_host" \
    "set -euo pipefail
     docker_root=\"\$(docker info --format '{{.DockerRootDir}}')\"
     free_kib=\"\$(df -Pk \"\$docker_root\" | awk 'NR == 2 { print \$4 }')\"
     test \"\$free_kib\" -ge '$required_kib'"

  while IFS= read -r chunk_name; do
    [[ "$chunk_name" =~ ^part-[0-9]{6}$ ]]
    read -r chunk_sha256 chunk_bytes manifest_chunk_name trailing < <(
      awk -v chunk="$chunk_name" '$3 == chunk { print }' "$chunk_manifest"
    )
    [[ "$manifest_chunk_name" == "$chunk_name" && -z "${trailing:-}" ]]
    chunk_path="$chunks_dir/$chunk_name"
    remote_chunk="$remote_archive_dir/$chunk_name"
    remote_partial="$remote_archive_dir/$chunk_name.partial-$session_id"
    uploaded=false
    for upload_attempt in {1..6}; do
      ssh "$ssh_host" "rm -f -- \"\$HOME/$remote_partial\""
      if scp "$chunk_path" "$ssh_host:$remote_partial" && \
         ssh "$ssh_host" \
           "set -euo pipefail
            partial=\"\$HOME/$remote_partial\"
            final=\"\$HOME/$remote_chunk\"
            test -f \"\$partial\" && test ! -L \"\$partial\"
            test \"\$(stat -c %s \"\$partial\")\" -eq '$chunk_bytes'
            printf '%s  %s\\n' '$chunk_sha256' \"\$partial\" | sha256sum --check --status
            rm -f -- \"\$final\"
            mv -- \"\$partial\" \"\$final\""; then
        uploaded=true
        break
      fi
      ssh "$ssh_host" "rm -f -- \"\$HOME/$remote_partial\"" >/dev/null 2>&1 || true
      if [[ "$upload_attempt" -lt 6 ]]; then
        printf 'Chunk upload failed for %s/%s (attempt %s/6); retrying.\n' \
          "$component" "$chunk_name" "$upload_attempt" >&2
      fi
    done
    [[ "$uploaded" == true ]] || {
      printf 'Chunk upload exhausted retries for %s/%s.\n' "$component" "$chunk_name" >&2
      exit 1
    }
  done < "$missing_chunks"

  ssh "$ssh_host" \
    "cd \"\$HOME/$remote_session\" && bash ./import-release-image.sh import '$release_id' '$source_sha' '$component' '$expected_id' '$archive_sha256' '$raw_bytes' '$compressed_bytes' chunks.manifest '$chunk_manifest_sha256'"
  rm -rf -- "$image_transfer_dir"
done

ssh "$ssh_host" \
  "cd \"\$HOME/$remote_session\" && bash ./import-release-image.sh finalize '$release_id' '$source_sha' '$expected_manifest_name' '$expected_manifest_sha256' '$manifest_name'"

host_manifest_incoming="$local_transfer_dir/$manifest_name"
scp "$ssh_host:$remote_session/$manifest_name" "$host_manifest_incoming"
chmod 0600 "$host_manifest_incoming"
cmp --silent "$expected_manifest" "$host_manifest_incoming" || {
  printf 'host image manifest differs from runner identities\n' >&2
  exit 1
}
mv -- "$host_manifest_incoming" "$host_image_manifest"

# Reattest all identities before deleting any stale cache left by an interrupted import.
ssh "$ssh_host" \
  "cd \"\$HOME/$remote_session\" && bash ./import-release-image.sh cleanup '$release_id' '$source_sha' '$expected_manifest_name' '$expected_manifest_sha256'"
ssh "$ssh_host" \
  "set -euo pipefail
   session=\"\$HOME/$remote_session\"
   rm -f -- \"\$session/import-release-image.sh\" \"\$session/release-image-set.sh\" \"\$session/$expected_manifest_name\" \"\$session/$manifest_name\" \
     \"\$session/$importer_incoming\" \"\$session/$image_set_incoming\" \"\$session/$expected_incoming\"
   test -z \"\$(find \"\$session\" -mindepth 1 -maxdepth 1 -print -quit)\"
   rmdir -- \"\$session\"
   rmdir -- \"\$HOME/$remote_base/sessions\" 2>/dev/null || true
   rmdir -- \"\$HOME/$remote_base/cache\" 2>/dev/null || true
   rmdir -- \"\$HOME/$remote_base\" 2>/dev/null || true"

printf 'Transferred and verified %s release images over pinned SSH.\n' \
  "${#OPENBMB_REQUIRED_IMAGES[@]}"
