#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-image-transfer-test.XXXXXX")"
case "$test_root" in
  "${TMPDIR:-/tmp}"/openbmb-image-transfer-test.*) ;;
  *) printf 'unsafe image transfer test directory\n' >&2; exit 1 ;;
esac
cleanup() {
  rm -rf -- "$test_root"
}
trap cleanup EXIT

fake_bin="$test_root/bin"
local_state="$test_root/local-docker"
remote_state="$test_root/remote-docker"
remote_home="$test_root/remote-home"
active_remote_home="$test_root/active-remote-home"
runner_temp="$test_root/runner-temp"
fake_docker_root="$test_root/docker-root"
fake_master_state="$test_root/ssh-masters"
fake_home="$test_root/home"
install -d -m 0700 "$fake_bin" "$local_state/refs" "$local_state/payloads" \
  "$remote_state/refs" "$remote_state/payloads" "$remote_home" \
  "$active_remote_home" "$runner_temp" "$fake_docker_root" "$fake_master_state" \
  "$fake_home" "$fake_home/.ssh"

cat > "$fake_bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${FAKE_DOCKER_STATE:?}"
key_for() {
  printf '%s' "$1" | sha256sum | awk '{ print $1 }'
}
record_ref() {
  local ref="$1"
  local image_id="$2"
  local revision="${3:-}"
  printf '%s %s\n' "$image_id" "$revision" > "$state/refs/$(key_for "$ref")"
}
read_ref() {
  local ref="$1"
  local path="$state/refs/$(key_for "$ref")"
  [[ -f "$path" ]] || exit 1
  cat "$path"
}
case "${1:-} ${2:-}" in
  'image inspect')
    [[ "$3" == --format && $# -eq 5 ]]
    read -r image_id revision < <(read_ref "$5")
    case "$4" in
      '{{.Id}}') printf '%s\n' "$image_id" ;;
      *org.opencontainers.image.revision*) printf '%s\n' "$revision" ;;
      *) exit 1 ;;
    esac
    ;;
  'info --format')
    printf '%s\n' "${FAKE_DOCKER_ROOT:?}"
    ;;
  'tag '*)
    [[ $# -eq 3 ]]
    read -r image_id revision < <(read_ref "$2")
    record_ref "$3" "$image_id" "$revision"
    ;;
  'save --output')
    [[ $# -eq 4 ]]
    read -r image_id revision < <(read_ref "$4")
    payload="$state/payloads/$(key_for "$4")"
    [[ -f "$payload" ]]
    {
      printf 'TAG=%s\nID=%s\nREV=%s\n' "$4" "$image_id" "$revision"
      cat "$payload"
    } > "$3"
    ;;
  'load '*)
    tag=''
    image_id=''
    revision=''
    while IFS='=' read -r key value; do
      case "$key" in
        TAG) tag="$value" ;;
        ID) image_id="$value" ;;
        REV) revision="$value" ;;
      esac
    done
    [[ "$tag" == openbmb-*:* ]]
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
    record_ref "$image_id" "$image_id" "$revision"
    record_ref "$tag" "$image_id" "$revision"
    ;;
  *)
    printf 'unexpected fake docker call: %q ' "$@" >&2
    printf '\n' >&2
    exit 1
    ;;
esac
FAKE_DOCKER

cat > "$fake_bin/df" <<'FAKE_DF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/fake 20000000 1 %s 1%% /fake\n' "${FAKE_DF_FREE_KIB:-9000000}"
FAKE_DF

cat > "$fake_bin/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -Eeuo pipefail
valid_host() {
  [[ "$1" == fake-prod || "$1" =~ ^fake-prod-lane-[1-3]$ ]]
}
master_path() {
  printf '%s/%s' "${FAKE_MASTER_STATE:?}" "$1"
}
control_path_for() {
  local host="$1"
  local host_hash
  valid_host "$host"
  [[ "${HOME:?}" == /* && -d "$HOME/.ssh" && ! -L "$HOME/.ssh" ]]
  host_hash="$(printf '%s' "$host" | sha1sum | awk '{ print $1 }')"
  [[ "$host_hash" =~ ^[0-9a-f]{40}$ ]]
  printf '%s/.ssh/openbmb-%s-%s' "$HOME" "$host" "$host_hash"
}
if [[ "${1:-}" == -G && "${2:-}" == -T && $# -eq 3 ]]; then
  printf 'controlpath %s\n' "$(control_path_for "$3")"
  exit 0
fi
if [[ "${1:-}" == -O && "${2:-}" == check && $# -eq 3 ]]; then
  host="$3"
  valid_host "$host"
  [[ -e "$(master_path "$host")" ]]
  printf 'master-check=%s\n' "$host" >> "${FAKE_SSH_LOG:?}"
  exit 0
fi
if [[ "${1:-}" == -MNf ]]; then
  host="${!#}"
  valid_host "$host"
  [[ "$host" =~ ^fake-prod-lane-[1-3]$ ]]
  : > "$(master_path "$host")"
  printf 'master-start=%s\n' "$host" >> "${FAKE_SSH_LOG:?}"
  exit 0
fi
[[ $# -eq 2 ]]
host="$1"
command_text="$2"
valid_host "$host"
[[ -e "$(master_path "$host")" ]]
printf 'ssh\n' >> "${FAKE_SSH_LOG:?}"
printf 'ssh-host=%s\n' "$host" >> "$FAKE_SSH_LOG"
if [[ "$command_text" == *'/run/lock/openbmb-image-transfer.lock'* ]]; then
  [[ "$host" == fake-prod ]]
  printf 'lock\n' >> "$FAKE_SSH_LOG"
  printf 'locked\n'
  if [[ "${FAKE_LOCK_EXIT_AFTER_HANDSHAKE:-false}" == true ]]; then
    exit 255
  fi
  if [[ "${FAKE_LOCK_EXIT_WHEN_UPLOAD_STARTED:-false}" == true ]]; then
    for _ in {1..6000}; do
      [[ -e "${FAKE_UPLOAD_STARTED_MARKER:?}" ]] && exit 255
      sleep 0.01
    done
    printf 'timed out waiting for an active upload\n' >&2
    exit 1
  fi
  cat >/dev/null
  exit 0
fi
# Real OpenSSH reads and forwards stdin even when the remote command ignores it.
# This deliberate consumer catches callers that run SSH inside a redirected
# `while read` loop without isolating the child from the loop's input file.
cat >/dev/null
if [[ "$host" =~ ^fake-prod-lane-[1-3]$ ]]; then
  [[ "$command_text" == *'.partial-'* || \
     "$command_text" == *'.openbmb-transfer/direct-v2/cache/'* ]]
  [[ "$command_text" != *' import '* && "$command_text" != *' finalize '* && \
     "$command_text" != *'/sessions/'* ]]
fi
if [[ "$command_text" == *"import 'git-0123456789ab'"*"'migrator'"* && \
      ! -e "${FAKE_IMPORT_FAILURE_MARKER:?}" ]]; then
  : > "$FAKE_IMPORT_FAILURE_MARKER"
  printf 'forced-import-disconnect\n' >> "$FAKE_SSH_LOG"
  exit 255
fi
HOME="${FAKE_REMOTE_HOME:?}" \
FAKE_DOCKER_STATE="${FAKE_REMOTE_DOCKER_STATE:?}" \
OPENBMB_OPERATION_LOCK_HELD=true \
PATH="${FAKE_REMOTE_PATH:?}" \
  bash -c "$command_text"
FAKE_SSH

cat > "$fake_bin/scp" <<'FAKE_SCP'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# -eq 2 ]]
cat >/dev/null
source_path="$1"
target_path="$2"
remote_home="${FAKE_REMOTE_HOME:?}"
valid_host() {
  [[ "$1" == fake-prod || "$1" =~ ^fake-prod-lane-[1-3]$ ]]
}
master_path() {
  printf '%s/%s' "${FAKE_MASTER_STATE:?}" "$1"
}
if [[ "$source_path" == *:* ]]; then
  host="${source_path%%:*}"
  valid_host "$host"
  [[ "$host" == fake-prod && -e "$(master_path "$host")" ]]
  remote_relative="${source_path#*:}"
  printf 'scp-host=%s\n' "$host" >> "${FAKE_SSH_LOG:?}"
  cp "$remote_home/$remote_relative" "$target_path"
  exit 0
fi
[[ "$target_path" == *:* ]]
host="${target_path%%:*}"
valid_host "$host"
[[ -e "$(master_path "$host")" ]]
remote_relative="${target_path#*:}"
printf 'scp-host=%s\n' "$host" >> "${FAKE_SSH_LOG:?}"
if [[ "$host" =~ ^fake-prod-lane-[1-3]$ ]]; then
  [[ "$remote_relative" == *'/part-'*'.partial-'*'-lane-'*'-attempt-'* ]]
else
  [[ "$remote_relative" == *'/sessions/'* || \
     "$remote_relative" == *'/cache/'*'/chunks.manifest.incoming-'* ]]
fi
if [[ "${FAKE_BLOCK_ACTIVE_UPLOAD:-false}" == true && \
      "$host" =~ ^fake-prod-lane-[1-3]$ ]]; then
  printf '%s\n' "$$" >> "${FAKE_ACTIVE_SCP_PIDS:?}"
  trap 'printf "%s\n" "$$" >> "${FAKE_ACTIVE_SCP_TERMINATED:?}"; exit 143' HUP INT TERM
  : > "${FAKE_UPLOAD_STARTED_MARKER:?}"
  for _ in {1..400}; do sleep 0.05; done
  printf '%s\n' "$$" >> "${FAKE_ACTIVE_SCP_COMPLETED:?}"
fi
if [[ "$remote_relative" =~ /migrator/.*/part-000000\.partial-1-1-lane-[1-3]-attempt-1$ && \
      ! -e "${FAKE_SCP_RETRY_MARKER:?}" ]]; then
  cp "$source_path" "$remote_home/$remote_relative"
  : > "$FAKE_SCP_RETRY_MARKER"
  rm -f -- "$(master_path "$host")"
  printf 'forced-chunk-retry\n' >> "${FAKE_SSH_LOG:?}"
  exit 1
fi
cp "$source_path" "$remote_home/$remote_relative"
FAKE_SCP
chmod 0700 "$fake_bin"/*

export PATH="$fake_bin:$PATH"
export HOME="$fake_home"
export RUNNER_TEMP="$runner_temp"
export FAKE_DOCKER_STATE="$local_state"
export FAKE_REMOTE_DOCKER_STATE="$remote_state"
export FAKE_DOCKER_ROOT="$fake_docker_root"
export FAKE_REMOTE_HOME="$remote_home"
export FAKE_REMOTE_PATH="$fake_bin:$PATH"
export FAKE_SSH_LOG="$test_root/ssh.log"
export FAKE_MASTER_STATE="$fake_master_state"
export FAKE_IMPORT_FAILURE_MARKER="$test_root/import-failed-once"
export FAKE_SCP_RETRY_MARKER="$test_root/scp-retried-once"
export FAKE_UPLOAD_STARTED_MARKER="$test_root/upload-started"
export FAKE_ACTIVE_SCP_PIDS="$test_root/active-scp-pids"
export FAKE_ACTIVE_SCP_TERMINATED="$test_root/active-scp-terminated"
export FAKE_ACTIVE_SCP_COMPLETED="$test_root/active-scp-completed"
export OPENBMB_TRANSFER_SSH_LANES=3
export OPENBMB_TRANSFER_CHUNK_BYTES=2048
export OPENBMB_SSH_COMMAND="$fake_bin/ssh"
: > "$fake_master_state/fake-prod"

key_for() {
  printf '%s' "$1" | sha256sum | awk '{ print $1 }'
}
seed_state_ref() {
  local state="$1"
  local ref="$2"
  local image_id="$3"
  local revision="${4:-}"
  printf '%s %s\n' "$image_id" "$revision" > "$state/refs/$(key_for "$ref")"
}

source_sha=0123456789abcdef0123456789abcdef01234567
release_id=git-0123456789ab
# shellcheck source=release-image-set.sh
source "$script_dir/release-image-set.sh"
openbmb_load_release_image_set "$release_id"
for index in "${!OPENBMB_REQUIRED_IMAGES[@]}"; do
  printf -v image_hex '%064x' "$((index + 101))"
  image_id="sha256:$image_hex"
  revision=''
  case "${OPENBMB_DELIVERY_COMPONENTS[$index]}" in
    api|migrator|client-web|admin-web) revision="$source_sha" ;;
  esac
  seed_state_ref "$local_state" "${OPENBMB_REQUIRED_IMAGES[$index]}" "$image_id" "$revision"
  head -c 4096 /dev/urandom | base64 > \
    "$local_state/payloads/$(key_for "${OPENBMB_REQUIRED_IMAGES[$index]}")"
done

# A lease channel that dies after its handshake must terminate the owner before any
# content cache can be published, even when ordinary SSH commands would still work.
export FAKE_LOCK_EXIT_AFTER_HANDSHAKE=true
lock_loss_manifest="$runner_temp/openbmb-images-$source_sha-9-1.txt"
set +e
bash "$script_dir/transfer-release-images.sh" \
  "$release_id" "$source_sha" 9 1 fake-prod "$lock_loss_manifest" \
  >"$test_root/lock-loss.out" 2>"$test_root/lock-loss.err"
lock_loss_status=$?
set -e
unset FAKE_LOCK_EXIT_AFTER_HANDSHAKE
[[ "$lock_loss_status" -ne 0 ]]
[[ ! -e "$lock_loss_manifest" ]]
[[ ! -e "$remote_home/.openbmb-transfer/direct-v2/cache/$release_id" ]]

# If the main lease reaches EOF while data SCP processes are in flight, the owner
# must fail closed, terminate every active child, and publish no final chunk or
# host manifest. Use an isolated remote home so the resumability fixtures below
# cannot accidentally hide a partially published active-upload attempt.
original_remote_home="$FAKE_REMOTE_HOME"
export FAKE_REMOTE_HOME="$active_remote_home"
export FAKE_BLOCK_ACTIVE_UPLOAD=true
export FAKE_LOCK_EXIT_WHEN_UPLOAD_STARTED=true
active_loss_manifest="$runner_temp/openbmb-images-$source_sha-8-1.txt"
set +e
bash "$script_dir/transfer-release-images.sh" \
  "$release_id" "$source_sha" 8 1 fake-prod "$active_loss_manifest" \
  >"$test_root/active-lock-loss.out" 2>"$test_root/active-lock-loss.err"
active_loss_status=$?
set -e
unset FAKE_BLOCK_ACTIVE_UPLOAD FAKE_LOCK_EXIT_WHEN_UPLOAD_STARTED
export FAKE_REMOTE_HOME="$original_remote_home"
[[ "$active_loss_status" -ne 0 ]]
[[ -s "$FAKE_ACTIVE_SCP_PIDS" && -s "$FAKE_ACTIVE_SCP_TERMINATED" ]]
[[ ! -e "$FAKE_ACTIVE_SCP_COMPLETED" && ! -e "$active_loss_manifest" ]]
[[ -z "$(find "$active_remote_home/.openbmb-transfer/direct-v2/cache/$release_id" \
  -type f -name 'part-[0-9][0-9][0-9][0-9][0-9][0-9]' -print -quit 2>/dev/null)" ]]
while IFS= read -r active_scp_pid; do
  ! kill -0 "$active_scp_pid" 2>/dev/null
done < "$FAKE_ACTIVE_SCP_PIDS"

# Attempt 1 uploads a verified migrator chunk (including one retry), then loses SSH
# immediately before import. Session metadata and content-addressed cache must survive.
first_manifest="$runner_temp/openbmb-images-$source_sha-1-1.txt"
set +e
bash "$script_dir/transfer-release-images.sh" \
  "$release_id" "$source_sha" 1 1 fake-prod "$first_manifest" \
  >"$test_root/attempt-1.out" 2>"$test_root/attempt-1.err"
first_status=$?
set -e
[[ "$first_status" -ne 0 ]]
[[ -e "$FAKE_IMPORT_FAILURE_MARKER" && -e "$FAKE_SCP_RETRY_MARKER" ]]
[[ ! -e "$first_manifest" ]]
old_session="$remote_home/.openbmb-transfer/direct-v2/sessions/1-1"
release_cache="$remote_home/.openbmb-transfer/direct-v2/cache/$release_id"
[[ -d "$old_session" ]]
migrator_chunk="$(find "$release_cache/migrator" -type f -name 'part-000000' -print -quit)"
[[ -n "$migrator_chunk" && -f "$migrator_chunk" ]]

# All non-migrator IDs already exist for attempt 2. API proves probe reuse; the
# manually retained API cache proves final cleanup handles load/cleanup disconnects.
for index in "${!OPENBMB_REQUIRED_IMAGES[@]}"; do
  [[ "${OPENBMB_DELIVERY_COMPONENTS[$index]}" == migrator ]] && continue
  read -r image_id revision < \
    "$local_state/refs/$(key_for "${OPENBMB_REQUIRED_IMAGES[$index]}")"
  seed_state_ref "$remote_state" "$image_id" "$image_id" "$revision"
done
stale_api_archive="$release_cache/api/$(printf 'c%.0s' {1..64})"
install -d -m 0700 "$stale_api_archive"
printf 'stale\n' > "$stale_api_archive/part-000000.partial-1-1"

# Set free space to exactly 4 GiB + raw tar bytes. A fully cached migrator passes
# only when already-present compressed chunks are not counted a second time.
probe_tar="$test_root/migrator.tar"
docker save --output "$probe_tar" "openbmb-migrator:$release_id"
probe_raw_bytes="$(stat -c %s "$probe_tar")"
export FAKE_DF_FREE_KIB=$((4194304 + (probe_raw_bytes + 1023) / 1024))

second_manifest="$runner_temp/openbmb-images-$source_sha-2-1.txt"
bash "$script_dir/transfer-release-images.sh" \
  "$release_id" "$source_sha" 2 1 fake-prod "$second_manifest" \
  >"$test_root/attempt-2.out" 2>"$test_root/attempt-2.err"

[[ "$(wc -l < "$second_manifest")" -eq 10 ]]
grep -Fq 'Reused verified chunk migrator/part-000000.' "$test_root/attempt-2.out"
grep -Fq 'Reused exact image ID for openbmb-api:' "$test_root/attempt-2.out"
[[ -d "$old_session" ]]
[[ ! -e "$remote_home/.openbmb-transfer/direct-v2/sessions/2-1" ]]
[[ ! -e "$release_cache" ]]
[[ "$(grep -Fc forced-chunk-retry "$FAKE_SSH_LOG")" -eq 1 ]]
for lane in 1 2 3; do
  grep -Fq "scp-host=fake-prod-lane-$lane" "$FAKE_SSH_LOG"
done
[[ "$(grep -Fc 'master-start=fake-prod-lane-1' "$FAKE_SSH_LOG")" -ge 2 ]]
[[ "$(grep -Fc lock "$FAKE_SSH_LOG")" -eq 4 ]]

printf 'Resumable SSH image transfer fixtures: OK\n'
