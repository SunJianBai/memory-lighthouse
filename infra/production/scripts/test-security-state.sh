#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
epoch_script="$script_dir/security-epoch.sh"
rotation_script="$script_dir/rotate-livekit-secret.sh"
backup_script="$script_dir/backup.sh"
migration_audit_script="$script_dir/audit-security-migration-recovery.sh"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-security-state.XXXXXX")"

cleanup_fixture() {
  case "$fixture_root" in
    "${TMPDIR:-/tmp}"/openbmb-security-state.*)
      [[ -d "$fixture_root" && ! -L "$fixture_root" ]] && rm -rf -- "$fixture_root"
      ;;
  esac
}
trap cleanup_fixture EXIT

fail() {
  printf 'SECURITY STATE TEST FAILED: %s\n' "$*" >&2
  exit 1
}

expect_failure() {
  local description="$1"
  shift
  if "$@" >"$fixture_root/unexpected.stdout" 2>"$fixture_root/expected.stderr"; then
    fail "$description unexpectedly succeeded"
  fi
}

make_release() {
  local release_id="$1"
  local epoch="$2"
  local release_path="$fixture_root/releases/$release_id"

  mkdir -p -- "$release_path/infra/production/compatibility"
  printf '%s\n' "$epoch" >"$release_path/infra/production/compatibility/security-epoch"
}

make_release legacy 1
make_release boundary 2
make_release same-epoch 2
make_release forward-fix 3
make_release restore-authorized 5
make_release overflow 2147483648
mkdir -p -- "$fixture_root/releases/pre-epoch"
mkdir -p -- "$fixture_root/state"
chmod 0700 -- "$fixture_root/state"
export OPENBMB_STATE_ROOT="$fixture_root/state"

expect_failure 'filesystem root as state root' \
  env OPENBMB_STATE_ROOT=/ bash "$epoch_script" minimum
expect_failure 'security epoch above the arithmetic bound' \
  bash "$epoch_script" assert-deploy "$fixture_root/releases/overflow"
[[ "$(bash "$epoch_script" minimum)" == 0 ]] || fail 'an uninitialized floor must read as epoch 0'
pending_probe_status=0
bash "$epoch_script" pending-exists >/dev/null 2>&1 || pending_probe_status=$?
[[ "$pending_probe_status" -eq 3 ]] || fail 'absent pending state must return status 3'
expect_failure 'migration recovery audit without pending security boundary' \
  env OPENBMB_OPERATION_LOCK_HELD=true OPENBMB_STATE_ROOT="$OPENBMB_STATE_ROOT" \
    bash "$migration_audit_script" \
      20260802150000_invalidate_legacy_exportable_device_credentials
grep -Fq 'recovery audit requires a pending security boundary' \
  "$fixture_root/expected.stderr" || \
  fail 'migration recovery audit did not fail explicitly without pending state'
bash "$epoch_script" assert-start "$fixture_root/releases/pre-epoch"
[[ "$(bash "$epoch_script" release-epoch "$fixture_root/releases/pre-epoch")" == 0 ]] || \
  fail 'only a manifest-free release may be classified as legacy epoch 0'
expect_failure 'deployment target without a manifest' \
  bash "$epoch_script" assert-deploy "$fixture_root/releases/pre-epoch"
bash "$epoch_script" assert-deploy "$fixture_root/releases/boundary"
bash "$epoch_script" begin "$fixture_root/releases/boundary"
bash "$epoch_script" pending-exists
[[ -f "$OPENBMB_STATE_ROOT/security-boundary.pending" ]] || fail 'begin did not publish pending state'
[[ "$(stat -c %a -- "$OPENBMB_STATE_ROOT/security-boundary.pending")" == 600 ]] || \
  fail 'pending state mode is not 0600'
expect_failure 'ordinary backup during pending security boundary' \
  env OPENBMB_OPERATION_LOCK_HELD=true OPENBMB_STATE_ROOT="$OPENBMB_STATE_ROOT" \
    bash "$backup_script"
grep -Fq 'Refusing an ordinary backup while a security boundary is pending.' \
  "$fixture_root/expected.stderr" || fail 'pending backup refusal was not explicit'
expect_failure 'service start during pre-migration pending state' \
  bash "$epoch_script" assert-start "$fixture_root/releases/boundary"
expect_failure 'rollback during pre-migration pending state' \
  bash "$epoch_script" assert-rollback "$fixture_root/releases/boundary"

expect_failure 'injected crash after floor promotion' \
  env OPENBMB_STATE_ROOT="$OPENBMB_STATE_ROOT" \
    OPENBMB_SECURITY_EPOCH_TEST_FAILPOINT=after-floor \
    bash "$epoch_script" finish "$fixture_root/releases/boundary"
[[ "$(bash "$epoch_script" minimum)" == 2 ]] || fail 'floor was not durably promoted before the injected crash'
[[ -f "$OPENBMB_STATE_ROOT/security-boundary.pending" ]] || fail 'pending state disappeared at the floor crash point'
expect_failure 'service start after floor promotion but before pending clear' \
  bash "$epoch_script" assert-start "$fixture_root/releases/boundary"

bash "$epoch_script" finish "$fixture_root/releases/boundary"
[[ ! -e "$OPENBMB_STATE_ROOT/security-boundary.pending" ]] || fail 'successful finish did not clear pending state'
[[ "$(stat -c %a -- "$OPENBMB_STATE_ROOT/minimum-security-epoch")" == 644 ]] || \
  fail 'minimum epoch mode is not 0644'
expect_failure 'application below durable floor' \
  bash "$epoch_script" assert-start "$fixture_root/releases/legacy"
expect_failure 'rollback below durable floor' \
  bash "$epoch_script" assert-rollback "$fixture_root/releases/legacy"
expect_failure 'pre-epoch application below durable floor' \
  bash "$epoch_script" assert-start "$fixture_root/releases/pre-epoch"
bash "$epoch_script" assert-start "$fixture_root/releases/same-epoch"
bash "$epoch_script" assert-rollback "$fixture_root/releases/same-epoch"

# An ordinary same-epoch deployment may safely recover the previous app, but
# it must stay blocked until that app has passed its health check and recovery
# explicitly clears the pending marker.
bash "$epoch_script" begin "$fixture_root/releases/same-epoch"
bash "$epoch_script" can-recover "$fixture_root/releases/boundary"
bash "$epoch_script" complete-recovery "$fixture_root/releases/boundary"
[[ ! -e "$OPENBMB_STATE_ROOT/security-boundary.pending" ]] || fail 'same-epoch recovery left pending state behind'
bash "$epoch_script" assert-start "$fixture_root/releases/boundary"

# A later fixed release may resume a crashed boundary, while the lower target
# can no longer be selected for recovery after pending has moved forward.
bash "$epoch_script" begin "$fixture_root/releases/boundary"
bash "$epoch_script" begin "$fixture_root/releases/forward-fix"
expect_failure 'recovery below a forwarded pending boundary' \
  bash "$epoch_script" can-recover "$fixture_root/releases/boundary"
bash "$epoch_script" finish "$fixture_root/releases/forward-fix"
[[ "$(bash "$epoch_script" minimum)" == 3 ]] || fail 'forward recovery did not promote the floor to epoch 3'

# Restoring data must retain the maximum of the live floor, the backup floor,
# the pending boundary (when present), and the release authorized to start.
printf '2\n' >"$fixture_root/backup-floor"
[[ "$(bash "$epoch_script" recover-minimum "$fixture_root/backup-floor" \
  "$fixture_root/releases/boundary")" == 3 ]] || \
  fail 'restore lowered the live security floor'
printf '4\n' >"$fixture_root/backup-floor"
[[ "$(bash "$epoch_script" recover-minimum "$fixture_root/backup-floor" \
  "$fixture_root/releases/forward-fix")" == 4 ]] || \
  fail 'restore did not adopt the higher backup security floor'
bash "$epoch_script" begin "$fixture_root/releases/restore-authorized"
printf '1\n' >"$fixture_root/backup-floor"
[[ "$(bash "$epoch_script" recover-minimum "$fixture_root/backup-floor" \
  "$fixture_root/releases/restore-authorized")" == 5 ]] || \
  fail 'restore did not preserve the pending/authorized security floor'
[[ -f "$OPENBMB_STATE_ROOT/security-boundary.pending" ]] || \
  fail 'restore incorrectly cleared pending security state'
bash "$epoch_script" finish "$fixture_root/releases/restore-authorized"
expect_failure 'malformed backup security floor' \
  bash "$epoch_script" recover-minimum "$fixture_root/releases/overflow/infra/production/compatibility/security-epoch" \
    "$fixture_root/releases/restore-authorized"

printf 'not-valid\n' >"$OPENBMB_STATE_ROOT/security-boundary.pending"
chmod 0600 -- "$OPENBMB_STATE_ROOT/security-boundary.pending"
expect_failure 'malformed pending state' \
  bash "$epoch_script" assert-start "$fixture_root/releases/forward-fix"
rm -f -- "$OPENBMB_STATE_ROOT/security-boundary.pending"

env_fixture="$fixture_root/infra.env"
old_secret='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
printf 'TZ=Asia/Shanghai\nLIVEKIT_API_SECRET=%s\nREDIS_APP_PASSWORD=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n' \
  "$old_secret" >"$env_fixture"
chmod 0640 -- "$env_fixture"
before_owner="$(stat -c %u:%g -- "$env_fixture")"
rotation_output="$(bash "$rotation_script" "$env_fixture" 2>&1)" || fail 'valid LiveKit secret rotation failed'
[[ -z "$rotation_output" ]] || fail 'successful secret rotation emitted output'
[[ "$(stat -c %a -- "$env_fixture")" == 640 ]] || fail 'secret rotation changed the env mode'
[[ "$(stat -c %u:%g -- "$env_fixture")" == "$before_owner" ]] || fail 'secret rotation changed env ownership'
! grep -Fq -- "$old_secret" "$env_fixture" || fail 'old LiveKit secret survived rotation'
[[ "$(grep -c '^LIVEKIT_API_SECRET=' "$env_fixture")" -eq 1 ]] || fail 'rotation changed the assignment count'
new_secret="$(sed -n 's/^LIVEKIT_API_SECRET=//p' "$env_fixture")"
[[ "$new_secret" =~ ^[A-Za-z0-9_-]{64}$ ]] || fail 'replacement LiveKit secret is not canonical base64url'

assert_invalid_env_unchanged() {
  local name="$1"
  local contents="$2"
  local invalid_env="$fixture_root/$name.env"
  local before_hash

  printf '%s' "$contents" >"$invalid_env"
  chmod 0640 -- "$invalid_env"
  before_hash="$(sha256sum "$invalid_env")"
  expect_failure "invalid rotation input: $name" bash "$rotation_script" "$invalid_env"
  [[ "$(sha256sum "$invalid_env")" == "$before_hash" ]] || \
    fail "invalid rotation input was modified: $name"
}

assert_invalid_env_unchanged missing $'TZ=Asia/Shanghai\n'
assert_invalid_env_unchanged duplicate \
  $'LIVEKIT_API_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nLIVEKIT_API_SECRET=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n'
assert_invalid_env_unchanged short $'LIVEKIT_API_SECRET=too-short\n'

printf 'Security epoch and LiveKit rotation fixtures: OK\n'
