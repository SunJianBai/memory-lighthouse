#!/usr/bin/env bash
set -Eeuo pipefail

state_root="${OPENBMB_STATE_ROOT:-/opt/openbmb}"
state_root="${state_root%/}"
[[ -n "$state_root" ]] || state_root=/
minimum_epoch_file="$state_root/minimum-security-epoch"
pending_file="$state_root/security-boundary.pending"
temporary_state_file=''
maximum_security_epoch=2147483647

cleanup_temporary_state() {
  if [[ -n "$temporary_state_file" ]]; then
    rm -f -- "$temporary_state_file"
  fi
}
trap cleanup_temporary_state EXIT

fail() {
  printf 'SECURITY EPOCH: %s\n' "$*" >&2
  exit 1
}

[[ "$state_root" == /* && "$state_root" != / && "$state_root" != *$'\n'* ]] || \
  fail 'OPENBMB_STATE_ROOT must be an absolute non-root path without newlines'

is_positive_epoch() {
  local value="$1"

  [[ "$value" =~ ^[1-9][0-9]*$ ]] || return 1
  (( ${#value} < ${#maximum_security_epoch} )) || \
    { [[ "${#value}" -eq "${#maximum_security_epoch}" ]] && \
      [[ "$value" == "$maximum_security_epoch" || "$value" < "$maximum_security_epoch" ]]; }
}

is_nonnegative_epoch() {
  [[ "$1" == 0 ]] || is_positive_epoch "$1"
}

expected_state_owner() {
  if [[ "$state_root" == /opt/openbmb ]]; then
    printf '0\n'
  else
    # Non-default roots exist solely so the state machine can be exercised in
    # an unprivileged fixture. Production uses /opt/openbmb and therefore UID 0.
    id -u
  fi
}

ensure_state_root() {
  local expected_owner
  local actual_owner
  local resolved_root

  expected_owner="$(expected_state_owner)"
  if [[ ! -e "$state_root" ]]; then
    mkdir -p -- "$state_root"
    chmod 0755 -- "$state_root"
  fi
  [[ -d "$state_root" && ! -L "$state_root" ]] || \
    fail "state root must be a real directory: $state_root"
  resolved_root="$(readlink -f -- "$state_root")"
  [[ "$resolved_root" == "$state_root" ]] || \
    fail "state root must not traverse symbolic links: $state_root"
  actual_owner="$(stat -c %u -- "$state_root")"
  [[ "$actual_owner" == "$expected_owner" ]] || \
    fail "state root must be owned by UID $expected_owner"
  if find "$state_root" -maxdepth 0 -perm /0022 -print -quit | grep -q .; then
    fail 'state root must not be writable by group or other users'
  fi
}

assert_managed_state_file() {
  local path="$1"
  local expected_owner

  [[ -f "$path" && ! -L "$path" ]] || \
    fail "state file must be a regular non-symlink: $path"
  expected_owner="$(expected_state_owner)"
  [[ "$(stat -c %u -- "$path")" == "$expected_owner" ]] || \
    fail "state file must be owned by UID $expected_owner: $path"
  if find "$path" -maxdepth 0 -perm /0022 -print -quit | grep -q .; then
    fail "state file must not be writable by group or other users: $path"
  fi
}

atomic_write_state() {
  local destination="$1"
  local mode="$2"
  local content="$3"
  local expected_owner

  ensure_state_root
  expected_owner="$(expected_state_owner)"
  temporary_state_file="$(mktemp -- "$state_root/.security-state.XXXXXX")"
  chmod "$mode" -- "$temporary_state_file"
  chown "$expected_owner" -- "$temporary_state_file"
  printf '%s\n' "$content" >"$temporary_state_file"
  sync -f -- "$temporary_state_file"
  mv -Tf -- "$temporary_state_file" "$destination"
  temporary_state_file=''
  sync -f -- "$state_root"
}

read_release_epoch() {
  local release_path="$1"
  local manifest="$release_path/infra/production/compatibility/security-epoch"
  local -a lines=()

  [[ -d "$release_path" ]] || fail "release directory is missing: $release_path"
  if [[ ! -e "$manifest" && ! -L "$manifest" ]]; then
    # Releases that predate the epoch protocol are legacy epoch 0. They may be
    # kept running only until a durable positive floor has been established.
    printf '0\n'
    return
  fi
  [[ -f "$manifest" && ! -L "$manifest" ]] || \
    fail "release security epoch manifest is not a regular file: $manifest"
  mapfile -t lines <"$manifest"
  [[ "${#lines[@]}" -eq 1 ]] && is_positive_epoch "${lines[0]}" || \
    fail "release security epoch must be between 1 and $maximum_security_epoch: $manifest"
  printf '%s\n' "${lines[0]}"
}

require_release_manifest() {
  local release_path="$1"
  local manifest="$release_path/infra/production/compatibility/security-epoch"

  [[ -f "$manifest" && ! -L "$manifest" ]] || \
    fail "deployment target lacks a security epoch manifest: $manifest"
}

read_minimum_epoch() {
  local -a lines=()

  ensure_state_root
  if [[ ! -e "$minimum_epoch_file" && ! -L "$minimum_epoch_file" ]]; then
    printf '0\n'
    return
  fi
  assert_managed_state_file "$minimum_epoch_file"
  mapfile -t lines <"$minimum_epoch_file"
  [[ "${#lines[@]}" -eq 1 ]] && is_nonnegative_epoch "${lines[0]}" || \
    fail "minimum-security-epoch must be between 0 and $maximum_security_epoch"
  printf '%s\n' "${lines[0]}"
}

read_epoch_artifact() {
  local artifact_path="$1"
  local -a lines=()

  [[ -f "$artifact_path" && ! -L "$artifact_path" ]] || \
    fail "security epoch artifact must be a regular non-symlink: $artifact_path"
  mapfile -t lines <"$artifact_path"
  [[ "${#lines[@]}" -eq 1 ]] && is_nonnegative_epoch "${lines[0]}" || \
    fail "security epoch artifact must be between 0 and $maximum_security_epoch: $artifact_path"
  printf '%s\n' "${lines[0]}"
}

pending_release=''
pending_epoch=''
load_pending() {
  local -a lines=()

  ensure_state_root
  [[ -e "$pending_file" || -L "$pending_file" ]] || return 1
  assert_managed_state_file "$pending_file"
  mapfile -t lines <"$pending_file"
  [[ "${#lines[@]}" -eq 3 ]] || fail 'security-boundary.pending is malformed'
  [[ "${lines[0]}" == format=1 ]] || fail 'security-boundary.pending has an unsupported format'
  [[ "${lines[1]}" == target_release=* ]] || fail 'security-boundary.pending lacks target_release'
  [[ "${lines[2]}" == target_epoch=* ]] || fail 'security-boundary.pending lacks target_epoch'
  pending_release="${lines[1]#target_release=}"
  pending_epoch="${lines[2]#target_epoch=}"
  [[ "$pending_release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || \
    fail 'security-boundary.pending has an unsafe target release'
  is_positive_epoch "$pending_epoch" || \
    fail "security-boundary.pending target epoch exceeds 1..$maximum_security_epoch"
}

write_pending() {
  local release_path="$1"
  local release_id
  local release_epoch
  local minimum_epoch
  local required_epoch

  require_release_manifest "$release_path"
  release_id="$(basename -- "$release_path")"
  [[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || \
    fail 'target release id is unsafe'
  release_epoch="$(read_release_epoch "$release_path")"
  minimum_epoch="$(read_minimum_epoch)"
  required_epoch="$minimum_epoch"
  if load_pending; then
    if (( pending_epoch > required_epoch )); then
      required_epoch="$pending_epoch"
    fi
  fi
  (( release_epoch >= required_epoch )) || \
    fail "target security epoch $release_epoch is below required epoch $required_epoch"

  atomic_write_state "$pending_file" 0600 \
    "$(printf 'format=1\ntarget_release=%s\ntarget_epoch=%s' "$release_id" "$release_epoch")"
}

required_epoch_while_pending() {
  local minimum_epoch
  local required_epoch

  minimum_epoch="$(read_minimum_epoch)"
  required_epoch="$minimum_epoch"
  if load_pending && (( pending_epoch > required_epoch )); then
    required_epoch="$pending_epoch"
  fi
  printf '%s\n' "$required_epoch"
}

pending_exists() {
  ensure_state_root
  if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
    return 3
  fi
  load_pending
}

assert_deploy_target() {
  local release_path="$1"
  local release_epoch
  local required_epoch

  require_release_manifest "$release_path"
  release_epoch="$(read_release_epoch "$release_path")"
  required_epoch="$(required_epoch_while_pending)"
  (( release_epoch >= required_epoch )) || \
    fail "target security epoch $release_epoch is below required epoch $required_epoch"
}

assert_service_start() {
  local release_path="$1"
  local release_epoch
  local minimum_epoch

  ensure_state_root
  if load_pending; then
    fail "startup is blocked by pending security boundary for $pending_release (epoch $pending_epoch)"
  fi
  release_epoch="$(read_release_epoch "$release_path")"
  minimum_epoch="$(read_minimum_epoch)"
  (( release_epoch >= minimum_epoch )) || \
    fail "application security epoch $release_epoch is below minimum epoch $minimum_epoch"
}

assert_rollback_target() {
  local release_path="$1"

  ensure_state_root
  if load_pending; then
    fail "rollback is blocked by pending security boundary for $pending_release (epoch $pending_epoch)"
  fi
  assert_service_start "$release_path"
}

can_recover_with() {
  local release_path="$1"
  local release_epoch
  local required_epoch

  release_epoch="$(read_release_epoch "$release_path")"
  required_epoch="$(required_epoch_while_pending)"
  (( release_epoch >= required_epoch ))
}

clear_pending_after_recovery() {
  local release_path="$1"
  local release_epoch

  can_recover_with "$release_path" || \
    fail 'recovery application is below the pending security boundary'
  if ! load_pending; then
    return
  fi
  release_epoch="$(read_release_epoch "$release_path")"
  atomic_write_state "$minimum_epoch_file" 0644 "$release_epoch"
  rm -f -- "$pending_file"
  sync -f -- "$state_root"
}

recover_minimum_epoch() {
  local backup_epoch_file="$1"
  local authorized_release_path="$2"
  local backup_epoch
  local authorized_release_epoch
  local recovered_epoch
  local required_epoch

  require_release_manifest "$authorized_release_path"
  backup_epoch="$(read_epoch_artifact "$backup_epoch_file")"
  authorized_release_epoch="$(read_release_epoch "$authorized_release_path")"
  required_epoch="$(required_epoch_while_pending)"
  recovered_epoch="$required_epoch"
  if (( backup_epoch > recovered_epoch )); then
    recovered_epoch="$backup_epoch"
  fi
  if (( authorized_release_epoch > recovered_epoch )); then
    recovered_epoch="$authorized_release_epoch"
  fi

  # Recovery may only preserve or raise an existing/pending boundary. It never
  # clears pending state; only a verified forward deployment may do that.
  atomic_write_state "$minimum_epoch_file" 0644 "$recovered_epoch"
  printf '%s\n' "$recovered_epoch"
}

finish_boundary() {
  local release_path="$1"
  local release_id
  local release_epoch
  local minimum_epoch

  require_release_manifest "$release_path"
  release_id="$(basename -- "$release_path")"
  release_epoch="$(read_release_epoch "$release_path")"
  load_pending || fail 'cannot finish a security boundary that is not pending'
  [[ "$release_id" == "$pending_release" ]] || \
    fail "pending boundary belongs to $pending_release, not $release_id"
  (( release_epoch >= pending_epoch )) || \
    fail 'release epoch is below its pending security boundary'
  minimum_epoch="$(read_minimum_epoch)"
  (( release_epoch >= minimum_epoch )) || \
    fail "release epoch $release_epoch is below minimum epoch $minimum_epoch"

  atomic_write_state "$minimum_epoch_file" 0644 "$release_epoch"
  case "${OPENBMB_SECURITY_EPOCH_TEST_FAILPOINT:-}" in
    '') ;;
    after-floor)
      printf 'SECURITY EPOCH: injected failure after minimum epoch promotion\n' >&2
      return 90
      ;;
    *) fail 'unknown OPENBMB_SECURITY_EPOCH_TEST_FAILPOINT' ;;
  esac
  rm -f -- "$pending_file"
  sync -f -- "$state_root"
}

usage() {
  printf 'usage: %s <release-epoch|minimum|pending-exists|pending-required|assert-deploy|begin|assert-start|assert-rollback|can-recover|complete-recovery|recover-minimum|finish> [arguments]\n' \
    "${BASH_SOURCE[0]}" >&2
  exit 2
}

command_name="${1:-}"
case "$command_name" in
  release-epoch)
    [[ $# -eq 2 ]] || usage
    read_release_epoch "$2"
    ;;
  minimum)
    [[ $# -eq 1 ]] || usage
    read_minimum_epoch
    ;;
  pending-exists)
    [[ $# -eq 1 ]] || usage
    pending_exists
    ;;
  pending-required)
    [[ $# -eq 1 ]] || usage
    required_epoch_while_pending
    ;;
  assert-deploy)
    [[ $# -eq 2 ]] || usage
    assert_deploy_target "$2"
    ;;
  begin)
    [[ $# -eq 2 ]] || usage
    write_pending "$2"
    ;;
  assert-start)
    [[ $# -eq 2 ]] || usage
    assert_service_start "$2"
    ;;
  assert-rollback)
    [[ $# -eq 2 ]] || usage
    assert_rollback_target "$2"
    ;;
  can-recover)
    [[ $# -eq 2 ]] || usage
    can_recover_with "$2"
    ;;
  complete-recovery)
    [[ $# -eq 2 ]] || usage
    clear_pending_after_recovery "$2"
    ;;
  recover-minimum)
    [[ $# -eq 3 ]] || usage
    recover_minimum_epoch "$2" "$3"
    ;;
  finish)
    [[ $# -eq 2 ]] || usage
    finish_boundary "$2"
    ;;
  *) usage ;;
esac
