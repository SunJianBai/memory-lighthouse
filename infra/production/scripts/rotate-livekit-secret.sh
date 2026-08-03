#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

infra_env="${1:-${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}}"
api_env="${OPENBMB_API_ENV_FILE:-/etc/openbmb/api.env}"
native_env="${OPENBMB_NATIVE_ENV_FILE:-/etc/openbmb/native-api.env}"
runtime_mode_bin="${OPENBMB_HYBRID_RUNTIME_MODE_BIN:-/usr/local/sbin/openbmb-runtime-mode}"
runtime_state="${OPENBMB_HYBRID_MODE_STATE:-/var/lib/openbmb/hybrid-runtime}"
upstream_helper="${OPENBMB_API_UPSTREAM_HELPER:-/usr/local/libexec/openbmb-switch-api-upstream}"
systemctl_bin="${OPENBMB_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
node_bin="${OPENBMB_NATIVE_NODE_BIN:-/opt/openbmb/runtime/node-v22.19.0-linux-x64/bin/node}"
native_env_renderer="${OPENBMB_NATIVE_ENV_RENDERER:-/usr/local/libexec/openbmb-native-api/render-native-env.mjs}"
expected_uid="${OPENBMB_ROTATION_EXPECTED_UID:-0}"
native_group="${OPENBMB_NATIVE_API_GROUP:-openbmb}"
test_failpoint="${OPENBMB_ROTATION_TEST_FAILPOINT:-}"
operation_lock="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"
flock_bin="${OPENBMB_FLOCK_BIN:-/usr/bin/flock}"

temporary_env_file=''
temporary_native_env_file=''
restore_temporary_file=''
old_infra_fd=''
old_native_fd=''
old_infra_metadata=''
old_native_metadata=''
rollback_required=false
operation_lock_fd=''

fail() {
  printf 'LIVEKIT SECRET ROTATION: %s\n' "$*" >&2
  exit 1
}

close_original_descriptors() {
  if [[ "$old_infra_fd" =~ ^[0-9]+$ ]]; then
    exec {old_infra_fd}<&-
    old_infra_fd=''
  fi
  if [[ "$old_native_fd" =~ ^[0-9]+$ ]]; then
    exec {old_native_fd}<&-
    old_native_fd=''
  fi
}

restore_from_descriptor() {
  local descriptor_fd="$1"
  local destination="$2"
  local metadata="$3"
  local owner group mode parent descriptor

  IFS=: read -r owner group mode <<<"$metadata"
  [[ "$descriptor_fd" =~ ^[0-9]+$ && "$owner" =~ ^[0-9]+$ && \
     "$group" =~ ^[0-9]+$ && "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  descriptor="/proc/$$/fd/$descriptor_fd"
  [[ -f "$descriptor" ]] || return 1
  parent="$(dirname -- "$destination")"
  restore_temporary_file="$(mktemp -- "$parent/.livekit-restore.XXXXXX")" || return 1
  if ! cp --reflink=auto -- "$descriptor" "$restore_temporary_file"; then
    rm -f -- "$restore_temporary_file"
    restore_temporary_file=''
    return 1
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    if ! chown "$owner:$group" -- "$restore_temporary_file"; then
      rm -f -- "$restore_temporary_file"
      restore_temporary_file=''
      return 1
    fi
  fi
  if ! chmod "$mode" -- "$restore_temporary_file" || \
     [[ "$(stat -c %u:%g:%a -- "$restore_temporary_file")" != "$metadata" ]] || \
     ! sync -f -- "$restore_temporary_file" || \
     ! mv -Tf -- "$restore_temporary_file" "$destination"; then
    rm -f -- "$restore_temporary_file"
    restore_temporary_file=''
    return 1
  fi
  restore_temporary_file=''
  sync -f -- "$parent" || return 1
  cmp -s -- "$descriptor" "$destination" || return 1
  [[ "$(stat -c %u:%g:%a -- "$destination")" == "$metadata" ]] || return 1
}

finish() {
  local status=$?
  local restore_status=0

  trap - EXIT HUP INT TERM
  set +e
  if [[ "$rollback_required" == true ]]; then
    restore_from_descriptor "$old_infra_fd" "$infra_env" "$old_infra_metadata" || restore_status=1
    restore_from_descriptor "$old_native_fd" "$native_env" "$old_native_metadata" || restore_status=1
    if [[ "$restore_status" -ne 0 ]]; then
      printf '%s\n' \
        'LIVEKIT SECRET ROTATION: automatic credential-file restoration failed; keep LiveKit and every API stopped' >&2
      status=1
    fi
  fi
  [[ -z "$temporary_env_file" ]] || rm -f -- "$temporary_env_file"
  [[ -z "$temporary_native_env_file" ]] || rm -f -- "$temporary_native_env_file"
  [[ -z "$restore_temporary_file" ]] || rm -f -- "$restore_temporary_file"
  close_original_descriptors
  exit "$status"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

assert_absolute_path() {
  local path="$1"
  local label="$2"
  [[ "$path" == /* && "$path" != / && "$path" != *$'\n'* && "$path" != *$'\r'* ]] || \
    fail "$label path must be an absolute non-root path without newlines"
}

assert_secure_file() {
  local path="$1"
  local label="$2"
  local owner="${3:-$expected_uid}"

  [[ -f "$path" && ! -L "$path" ]] || fail "$label must be a regular non-symlink"
  [[ "$(stat -c %u -- "$path")" == "$owner" ]] || fail "$label has an unexpected owner"
  if find "$path" -maxdepth 0 -perm /0022 -print -quit | grep -q .; then
    fail "$label must not be writable by group or other users"
  fi
}

assert_secure_directory() {
  local path="$1"
  local label="$2"

  [[ -d "$path" && ! -L "$path" ]] || fail "$label must be a regular directory"
  [[ "$(stat -c %u -- "$path")" == "$expected_uid" ]] || fail "$label has an unexpected owner"
  if find "$path" -maxdepth 0 -perm /0022 -print -quit | grep -q .; then
    fail "$label must not be writable by group or other users"
  fi
}

assert_secure_executable() {
  local path="$1"
  local label="$2"

  assert_absolute_path "$path" "$label"
  assert_secure_file "$path" "$label"
  [[ -x "$path" ]] || fail "$label is not executable"
}

prepare_operation_lock() {
  local parent mode lock_owner

  assert_absolute_path "$operation_lock" 'production operation lock'
  parent="$(dirname -- "$operation_lock")"
  [[ -d "$parent" && ! -L "$parent" ]] || fail 'production operation-lock parent is unsafe'
  lock_owner="$(id -u)"
  if [[ "$infra_env" == /etc/openbmb/infra.env ]]; then lock_owner=0; fi
  [[ "$(stat -c %u -- "$parent")" == "$lock_owner" ]] || \
    fail 'production operation-lock parent has an unexpected owner'
  mode="$((8#$(stat -c %a -- "$parent")))"
  if (( (mode & 8#0022) != 0 && (mode & 8#1000) == 0 )); then
    fail 'writable production operation-lock parent must have the sticky bit'
  fi

  if [[ ! -e "$operation_lock" && ! -L "$operation_lock" ]]; then
    (umask 077; set -o noclobber; : >"$operation_lock") 2>/dev/null || true
  fi
  [[ -f "$operation_lock" && ! -L "$operation_lock" ]] || \
    fail 'production operation lock must be a regular non-symlink'
  [[ "$(stat -c %u -- "$operation_lock")" == "$lock_owner" ]] || \
    fail 'production operation lock has an unexpected owner'
  if find "$operation_lock" -maxdepth 0 -perm /0022 -print -quit | grep -q .; then
    fail 'production operation lock must not be writable by group or other users'
  fi
}

take_operation_lock() {
  local inherited_fd descriptor

  [[ -x "$flock_bin" ]] || fail 'flock is required for LiveKit secret rotation'
  prepare_operation_lock
  case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
    true)
      inherited_fd="${OPENBMB_OPERATION_LOCK_FD:-}"
      [[ "$inherited_fd" =~ ^([3-9]|[1-9][0-9]+)$ ]] || \
        fail 'inherited production operation-lock descriptor is missing'
      descriptor="/proc/$$/fd/$inherited_fd"
      [[ -e "$descriptor" ]] || fail 'inherited production operation-lock descriptor is closed'
      [[ "$(stat -Lc %d:%i -- "$descriptor")" == \
         "$(stat -Lc %d:%i -- "$operation_lock")" ]] || \
        fail 'inherited descriptor does not reference the production operation lock'
      "$flock_bin" --exclusive --wait 0 --conflict-exit-code 75 "$inherited_fd" || \
        fail 'inherited production operation lock is not held'
      operation_lock_fd="$inherited_fd"
      ;;
    false)
      exec {operation_lock_fd}<>"$operation_lock"
      "$flock_bin" --exclusive \
        --wait "${OPENBMB_OPERATION_LOCK_WAIT_SECONDS:-120}" \
        --conflict-exit-code 75 "$operation_lock_fd" || \
        fail 'could not acquire the production operation lock'
      ;;
    *) fail 'OPENBMB_OPERATION_LOCK_HELD must be true or false' ;;
  esac
}

assert_native_unit_inactive() {
  local unit="$1"
  local load_state
  local state
  local unit_file_state

  load_state="$("$systemctl_bin" show --property=LoadState --value "$unit")" || \
    fail 'could not inspect native API unit load state'
  [[ "$load_state" == loaded ]] || fail 'both native API units must be installed before LiveKit secret rotation'
  state="$("$systemctl_bin" show --property=ActiveState --value "$unit")" || \
    fail 'could not inspect native API unit state'
  [[ "$state" == inactive ]] || fail 'both native API units must be inactive before LiveKit secret rotation'
  unit_file_state="$("$systemctl_bin" show --property=UnitFileState --value "$unit")" || \
    fail 'could not inspect native API unit enablement state'
  [[ "$unit_file_state" == disabled ]] || \
    fail 'both native API units must be disabled before LiveKit secret rotation'
}

assert_hybrid_rotation_boundary() {
  local -a mode_lines=()
  local upstream native_gid native_group_entry
  local mode_file="$runtime_state/mode"
  local transition_file="$runtime_state/transition.pending"

  [[ "$expected_uid" =~ ^[0-9]+$ && "$(id -u)" == "$expected_uid" ]] || \
    fail 'hybrid credential rotation must run as the expected service-control owner'
  [[ "$native_group" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail 'native API group name is invalid'
  [[ "$infra_env" != "$api_env" && "$infra_env" != "$native_env" && "$api_env" != "$native_env" ]] || \
    fail 'infrastructure, API source and native API environment paths must be distinct'

  for managed_path in \
    "$api_env" "$native_env" "$runtime_mode_bin" "$runtime_state" \
    "$upstream_helper" "$systemctl_bin" "$node_bin" "$native_env_renderer"; do
    assert_absolute_path "$managed_path" 'hybrid control'
  done

  assert_secure_executable "$runtime_mode_bin" 'hybrid runtime-mode control'
  assert_secure_directory "$runtime_state" 'hybrid runtime state'
  assert_secure_file "$mode_file" 'hybrid runtime mode'
  mapfile -t mode_lines <"$mode_file"
  [[ "${#mode_lines[@]}" -eq 1 && "${mode_lines[0]}" == docker ]] || \
    fail 'LiveKit secret rotation requires runtime mode docker'
  [[ ! -e "$transition_file" && ! -L "$transition_file" ]] || \
    fail 'LiveKit secret rotation requires pending=no'

  assert_secure_executable "$upstream_helper" 'API upstream helper'
  upstream="$("$upstream_helper" current)" || fail 'could not read the managed API upstream'
  [[ "$upstream" == 127.0.0.1:13100 ]] || \
    fail 'LiveKit secret rotation requires upstream 127.0.0.1:13100'

  assert_secure_executable "$systemctl_bin" 'systemctl'
  assert_native_unit_inactive openbmb-native-api@blue.service
  assert_native_unit_inactive openbmb-native-api@green.service

  assert_secure_executable "$node_bin" 'fixed native Node runtime'
  [[ "$("$node_bin" --version)" == v22.19.0 ]] || \
    fail 'fixed native Node runtime must be version 22.19.0'
  assert_secure_executable "$native_env_renderer" 'native environment renderer'
  assert_secure_file "$api_env" 'API source environment'
  assert_secure_file "$native_env" 'native API environment'
  native_group_entry="$(getent group "$native_group")" || fail 'native API group does not exist'
  native_gid="$(awk -F: 'NR == 1 { print $3 }' <<<"$native_group_entry")"
  [[ "$native_gid" =~ ^[0-9]+$ ]] || fail 'native API group does not exist'
  [[ "$(stat -c %u:%g:%a -- "$native_env")" == "$expected_uid:$native_gid:640" ]] || \
    fail 'native API environment must retain owner/group mode root:openbmb 0640'
}

assert_absolute_path "$infra_env" 'infrastructure environment'
infra_expected_uid="$(id -u)"
if [[ "$infra_env" == /etc/openbmb/infra.env ]]; then
  infra_expected_uid=0
fi
assert_secure_file "$infra_env" 'infrastructure environment' "$infra_expected_uid"
if [[ "$infra_env" == /etc/openbmb/infra.env ]]; then
  [[ "$(id -u)" == 0 ]] || fail 'the production infrastructure env must be rotated by root'
fi
if find "$infra_env" -maxdepth 0 -perm /0037 -print -quit | grep -q .; then
  fail 'infrastructure env must use mode 0640 or stricter'
fi

# The status boundary and both file commits must remain under the same public
# production-operation lock used by runtime-mode switches and full releases.
# Full-release callers pass their real inherited descriptor; direct operators
# acquire the lock here.
take_operation_lock

hybrid_control_present=false
if [[ -e "$runtime_mode_bin" || -L "$runtime_mode_bin" || \
      -e "$runtime_state" || -L "$runtime_state" ]]; then
  hybrid_control_present=true
  assert_hybrid_rotation_boundary
fi

assert_container_stopped() {
  local container_name="$1"
  local container_ids
  local running

  container_ids="$(
    docker container ls --all --format '{{.ID}} {{.Names}}' |
      awk -v wanted="$container_name" '$2 == wanted { print $1 }'
  )"
  if [[ -z "$container_ids" ]]; then
    return
  fi
  [[ "$container_ids" != *$'\n'* ]] || \
    fail "multiple containers unexpectedly use the $container_name name"
  running="$(docker inspect --format '{{.State.Running}}' "$container_ids")"
  [[ "$running" == false ]] || \
    fail "$container_name must be stopped before LiveKit secret rotation"
}

if [[ "$infra_env" == /etc/openbmb/infra.env ]]; then
  command -v docker >/dev/null 2>&1 || fail 'docker is required to verify the production stop boundary'
  assert_container_stopped openbmb-api
  assert_container_stopped openbmb-livekit
fi

old_secret=''
secret_count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == LIVEKIT_API_SECRET=* ]]; then
    secret_count=$((secret_count + 1))
    old_secret="${line#LIVEKIT_API_SECRET=}"
  fi
done <"$infra_env"
[[ "$secret_count" -eq 1 ]] || \
  fail 'infrastructure env must contain exactly one LIVEKIT_API_SECRET assignment'
[[ "$old_secret" =~ ^[A-Za-z0-9_-]{32,}$ ]] || \
  fail 'existing LIVEKIT_API_SECRET is not a valid base64url value'

new_secret=''
for _attempt in 1 2 3; do
  new_secret="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\r\n')"
  if [[ "$new_secret" =~ ^[A-Za-z0-9_-]{64}$ && "$new_secret" != "$old_secret" ]]; then
    break
  fi
  new_secret=''
done
[[ -n "$new_secret" ]] || fail 'could not generate a distinct LiveKit API secret'

env_directory="$(dirname -- "$infra_env")"
temporary_env_file="$(mktemp -- "$env_directory/.infra.env.livekit.XXXXXX")"
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == LIVEKIT_API_SECRET=* ]]; then
    printf 'LIVEKIT_API_SECRET=%s\n' "$new_secret"
  else
    printf '%s\n' "$line"
  fi
done <"$infra_env" >"$temporary_env_file"

chmod --reference="$infra_env" -- "$temporary_env_file"
if [[ "$(id -u)" == 0 ]]; then
  chown --reference="$infra_env" -- "$temporary_env_file"
fi
[[ "$(stat -c %u:%g -- "$temporary_env_file")" == "$(stat -c %u:%g -- "$infra_env")" ]] || \
  fail 'temporary env ownership differs from the original'
[[ "$(stat -c %a -- "$temporary_env_file")" == "$(stat -c %a -- "$infra_env")" ]] || \
  fail 'temporary env mode differs from the original'

sync -f -- "$temporary_env_file"

if [[ "$hybrid_control_present" == false ]]; then
  mv -Tf -- "$temporary_env_file" "$infra_env"
  temporary_env_file=''
  sync -f -- "$env_directory"
  exit 0
fi

# Render from the candidate infrastructure environment before either live
# input is replaced. The installed renderer repeats the source-file checks and
# emits only the reviewed application credential surface.
native_env_directory="$(dirname -- "$native_env")"
temporary_native_env_file="$(mktemp -- "$native_env_directory/.native-api.env.livekit.XXXXXX")"
"$node_bin" "$native_env_renderer" \
  --infra "$temporary_env_file" \
  --api "$api_env" >"$temporary_native_env_file"
[[ -s "$temporary_native_env_file" ]] || fail 'rendered native API environment is empty'
if [[ "$(id -u)" == 0 ]]; then
  chown --reference="$native_env" -- "$temporary_native_env_file"
fi
chmod --reference="$native_env" -- "$temporary_native_env_file"
[[ "$(stat -c %u:%g:%a -- "$temporary_native_env_file")" == \
   "$(stat -c %u:%g:%a -- "$native_env")" ]] || \
  fail 'rendered native API environment metadata differs from the original'
[[ "$(grep -c '^LIVEKIT_API_SECRET=' "$temporary_native_env_file")" -eq 1 ]] || \
  fail 'rendered native API environment has an invalid LiveKit secret assignment count'
grep -Fxq -- "LIVEKIT_API_SECRET=$new_secret" "$temporary_native_env_file" || \
  fail 'rendered native API environment does not contain the replacement LiveKit secret'
! grep -Fq -- "$old_secret" "$temporary_native_env_file" || \
  fail 'rendered native API environment retained the previous LiveKit secret'
sync -f -- "$temporary_native_env_file"

# Hold the original inodes open until both replacements are durable. If an
# ordinary command failure or signal occurs after the first rename, the EXIT
# trap can reconstruct both exact pre-rotation inputs without a named secret
# backup being left on disk.
exec {old_infra_fd}<"$infra_env"
exec {old_native_fd}<"$native_env"
old_infra_metadata="$(stat -Lc %u:%g:%a -- "/proc/$$/fd/$old_infra_fd")"
old_native_metadata="$(stat -Lc %u:%g:%a -- "/proc/$$/fd/$old_native_fd")"
rollback_required=true

mv --no-target-directory --force -- "$temporary_env_file" "$infra_env"
temporary_env_file=''
if [[ "$test_failpoint" == after-infra-commit ]]; then
  fail 'injected failure after infrastructure environment commit'
fi
[[ -z "$test_failpoint" ]] || fail 'unknown rotation test failpoint'
mv -Tf -- "$temporary_native_env_file" "$native_env"
temporary_native_env_file=''
sync -f -- "$infra_env" "$native_env"
sync -f -- "$env_directory"
if [[ "$native_env_directory" != "$env_directory" ]]; then
  sync -f -- "$native_env_directory"
fi

[[ "$(stat -c %u:%g:%a -- "$infra_env")" == "$old_infra_metadata" ]] || \
  fail 'committed infrastructure environment metadata changed'
[[ "$(stat -c %u:%g:%a -- "$native_env")" == "$old_native_metadata" ]] || \
  fail 'committed native API environment metadata changed'
rollback_required=false
close_original_descriptors

# Deliberately emit nothing on success. In particular, neither the old nor the
# replacement secret may enter deployment logs.
