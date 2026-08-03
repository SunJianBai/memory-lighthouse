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

export OPENBMB_OPERATION_LOCK="$fixture_root/openbmb-operation.lock"
export OPENBMB_ROTATION_EXPECTED_UID="$(id -u)"
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

# Once the hybrid control plane exists, the root-only infrastructure input and
# the minimized native API environment are one credential transaction. These
# small executables model the installed fixed runtime, renderer, upstream
# adapter and systemd state without requiring a host-level installation.
hybrid_fixture="$fixture_root/hybrid-control"
hybrid_state="$hybrid_fixture/state"
hybrid_runtime_control="$hybrid_fixture/openbmb-runtime-mode"
hybrid_upstream_helper="$hybrid_fixture/openbmb-switch-api-upstream"
hybrid_systemctl="$hybrid_fixture/systemctl"
hybrid_node="$hybrid_fixture/node"
hybrid_renderer="$hybrid_fixture/render-native-env.mjs"
hybrid_api_env="$hybrid_fixture/api.env"
hybrid_infra_env="$hybrid_fixture/infra.env"
hybrid_native_env="$hybrid_fixture/native-api.env"
hybrid_render_log="$hybrid_fixture/render.log"
mkdir -p -- "$hybrid_state"
chmod 0700 -- "$hybrid_fixture" "$hybrid_state"
printf 'docker\n' >"$hybrid_state/mode"
chmod 0600 -- "$hybrid_state/mode"

cat >"$hybrid_runtime_control" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$hybrid_upstream_helper" <<'EOF'
#!/usr/bin/env bash
[[ "$#" -eq 1 && "$1" == current ]] || exit 2
printf '%s\n' "${MOCK_UPSTREAM:-127.0.0.1:13100}"
EOF
cat >"$hybrid_systemctl" <<'EOF'
#!/usr/bin/env bash
[[ "$#" -eq 4 && "$1" == show && "$3" == --value ]] || exit 2
case "$2" in
  --property=LoadState)
    printf '%s\n' "${MOCK_LOAD_STATE:-loaded}"
    ;;
  --property=ActiveState)
    case "$4" in
      openbmb-native-api@blue.service) printf '%s\n' "${MOCK_BLUE_STATE:-inactive}" ;;
      openbmb-native-api@green.service) printf '%s\n' "${MOCK_GREEN_STATE:-inactive}" ;;
      *) exit 3 ;;
    esac
    ;;
  --property=UnitFileState)
    case "$4" in
      openbmb-native-api@blue.service) printf '%s\n' "${MOCK_BLUE_UNIT_FILE_STATE:-disabled}" ;;
      openbmb-native-api@green.service) printf '%s\n' "${MOCK_GREEN_UNIT_FILE_STATE:-disabled}" ;;
      *) exit 3 ;;
    esac
    ;;
  *) exit 2 ;;
esac
EOF
cat >"$hybrid_node" <<'EOF'
#!/usr/bin/env bash
if [[ "$#" -eq 1 && "$1" == --version ]]; then
  printf 'v22.19.0\n'
  exit 0
fi
[[ "${1:-}" == "$MOCK_EXPECTED_RENDERER" ]] || exit 80
shift
exec "$MOCK_EXPECTED_RENDERER" "$@"
EOF
cat >"$hybrid_renderer" <<'EOF'
#!/usr/bin/env bash
[[ "$#" -eq 4 && "$1" == --infra && "$3" == --api ]] || exit 2
[[ -f "$2" && -f "$4" ]] || exit 3
secret="$(sed -n 's/^LIVEKIT_API_SECRET=//p' "$2")"
[[ "$secret" =~ ^[A-Za-z0-9_-]{64}$ ]] || exit 4
: >"$MOCK_RENDER_LOG"
printf 'HOST=127.0.0.1\nLIVEKIT_API_SECRET=%s\n' "$secret"
EOF
chmod 0500 -- \
  "$hybrid_runtime_control" "$hybrid_upstream_helper" "$hybrid_systemctl" \
  "$hybrid_node" "$hybrid_renderer"

hybrid_old_secret='CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
printf 'SMTP_HOST=smtp.example.invalid\n' >"$hybrid_api_env"
printf 'OPENBMB_DOMAIN=example.invalid\nLIVEKIT_API_SECRET=%s\n' \
  "$hybrid_old_secret" >"$hybrid_infra_env"
printf 'HOST=127.0.0.1\nLIVEKIT_API_SECRET=%s\n' \
  "$hybrid_old_secret" >"$hybrid_native_env"
chmod 0600 -- "$hybrid_api_env" "$hybrid_infra_env"
chmod 0640 -- "$hybrid_native_env"
hybrid_infra_metadata="$(stat -c %u:%g:%a -- "$hybrid_infra_env")"
hybrid_native_metadata="$(stat -c %u:%g:%a -- "$hybrid_native_env")"

run_hybrid_rotation() {
  env \
    OPENBMB_ROTATION_EXPECTED_UID="$(id -u)" \
    OPENBMB_NATIVE_API_GROUP="$(id -gn)" \
    OPENBMB_HYBRID_RUNTIME_MODE_BIN="$hybrid_runtime_control" \
    OPENBMB_HYBRID_MODE_STATE="$hybrid_state" \
    OPENBMB_API_UPSTREAM_HELPER="$hybrid_upstream_helper" \
    OPENBMB_SYSTEMCTL_BIN="$hybrid_systemctl" \
    OPENBMB_NATIVE_NODE_BIN="$hybrid_node" \
    OPENBMB_NATIVE_ENV_RENDERER="$hybrid_renderer" \
    OPENBMB_API_ENV_FILE="$hybrid_api_env" \
    OPENBMB_NATIVE_ENV_FILE="$hybrid_native_env" \
    MOCK_EXPECTED_RENDERER="$hybrid_renderer" \
    MOCK_RENDER_LOG="$hybrid_render_log" \
    "$@" bash "$rotation_script" "$hybrid_infra_env"
}

exec {inherited_rotation_lock_fd}<>"$OPENBMB_OPERATION_LOCK"
flock --exclusive "$inherited_rotation_lock_fd"
hybrid_rotation_output="$(run_hybrid_rotation \
  OPENBMB_OPERATION_LOCK_HELD=true \
  OPENBMB_OPERATION_LOCK_FD="$inherited_rotation_lock_fd" 2>&1)" || \
  fail 'hybrid LiveKit secret rotation failed'
flock --unlock "$inherited_rotation_lock_fd"
exec {inherited_rotation_lock_fd}>&-
[[ -z "$hybrid_rotation_output" ]] || fail 'hybrid secret rotation emitted output'
[[ -f "$hybrid_render_log" ]] || fail 'hybrid secret rotation did not use the installed renderer'
[[ "$(stat -c %u:%g:%a -- "$hybrid_infra_env")" == "$hybrid_infra_metadata" ]] || \
  fail 'hybrid rotation changed infrastructure env ownership or mode'
[[ "$(stat -c %u:%g:%a -- "$hybrid_native_env")" == "$hybrid_native_metadata" ]] || \
  fail 'hybrid rotation changed native env ownership or mode'
hybrid_new_infra_secret="$(sed -n 's/^LIVEKIT_API_SECRET=//p' "$hybrid_infra_env")"
hybrid_new_native_secret="$(sed -n 's/^LIVEKIT_API_SECRET=//p' "$hybrid_native_env")"
[[ "$hybrid_new_infra_secret" =~ ^[A-Za-z0-9_-]{64}$ ]] || \
  fail 'hybrid infrastructure secret is not canonical base64url'
[[ "$hybrid_new_native_secret" == "$hybrid_new_infra_secret" ]] || \
  fail 'native API environment retained a stale LiveKit secret'
! grep -Fq -- "$hybrid_old_secret" "$hybrid_native_env" || \
  fail 'old LiveKit secret survived in the native API environment'

assert_hybrid_precondition_failure() {
  local description="$1"
  shift
  local infra_hash native_hash
  infra_hash="$(sha256sum "$hybrid_infra_env")"
  native_hash="$(sha256sum "$hybrid_native_env")"
  expect_failure "$description" run_hybrid_rotation "$@"
  [[ "$(sha256sum "$hybrid_infra_env")" == "$infra_hash" ]] || \
    fail "$description changed the infrastructure env"
  [[ "$(sha256sum "$hybrid_native_env")" == "$native_hash" ]] || \
    fail "$description changed the native env"
}

printf 'hybrid\n' >"$hybrid_state/mode"
assert_hybrid_precondition_failure 'hybrid rotation outside Docker mode'
printf 'docker\n' >"$hybrid_state/mode"
printf 'version=1\n' >"$hybrid_state/transition.pending"
chmod 0600 -- "$hybrid_state/transition.pending"
assert_hybrid_precondition_failure 'hybrid rotation with a pending transition'
rm -f -- "$hybrid_state/transition.pending"
assert_hybrid_precondition_failure 'hybrid rotation with a native upstream' \
  MOCK_UPSTREAM=127.0.0.1:13101
assert_hybrid_precondition_failure 'hybrid rotation with blue active' \
  MOCK_BLUE_STATE=active
assert_hybrid_precondition_failure 'hybrid rotation with green active' \
  MOCK_GREEN_STATE=active
assert_hybrid_precondition_failure 'hybrid rotation with blue enabled' \
  MOCK_BLUE_UNIT_FILE_STATE=enabled
assert_hybrid_precondition_failure 'hybrid rotation with green enabled' \
  MOCK_GREEN_UNIT_FILE_STATE=enabled
assert_hybrid_precondition_failure 'hybrid rotation with a missing native unit' \
  MOCK_LOAD_STATE=not-found
mv -- "$hybrid_runtime_control" "$hybrid_runtime_control.missing"
assert_hybrid_precondition_failure 'hybrid rotation with durable state but missing runtime control'
mv -- "$hybrid_runtime_control.missing" "$hybrid_runtime_control"

# The rotation must participate in the same lock as runtime-mode transitions.
# A competing holder blocks direct execution, while HELD=true is accepted only
# when the inherited descriptor names the exact locked inode.
hybrid_infra_hash_before_lock_failure="$(sha256sum "$hybrid_infra_env")"
hybrid_native_hash_before_lock_failure="$(sha256sum "$hybrid_native_env")"
exec {contended_rotation_lock_fd}<>"$OPENBMB_OPERATION_LOCK"
flock --exclusive "$contended_rotation_lock_fd"
expect_failure 'hybrid rotation while operation lock is held' \
  run_hybrid_rotation OPENBMB_OPERATION_LOCK_WAIT_SECONDS=0
flock --unlock "$contended_rotation_lock_fd"
exec {contended_rotation_lock_fd}>&-
exec {wrong_rotation_lock_fd}</dev/null
expect_failure 'hybrid rotation with a false inherited lock descriptor' \
  run_hybrid_rotation \
    OPENBMB_OPERATION_LOCK_HELD=true \
    OPENBMB_OPERATION_LOCK_FD="$wrong_rotation_lock_fd"
exec {wrong_rotation_lock_fd}<&-
[[ "$(sha256sum "$hybrid_infra_env")" == "$hybrid_infra_hash_before_lock_failure" ]] || \
  fail 'operation-lock rejection changed the infrastructure env'
[[ "$(sha256sum "$hybrid_native_env")" == "$hybrid_native_hash_before_lock_failure" ]] || \
  fail 'operation-lock rejection changed the native env'

# A failure after the first rename exercises the transaction rollback: both
# source files must return byte-for-byte, and the diagnostic must not disclose
# the credential being restored.
hybrid_infra_hash_before_failure="$(sha256sum "$hybrid_infra_env")"
hybrid_native_hash_before_failure="$(sha256sum "$hybrid_native_env")"
expect_failure 'hybrid rotation after infrastructure commit' \
  run_hybrid_rotation OPENBMB_ROTATION_TEST_FAILPOINT=after-infra-commit
[[ "$(sha256sum "$hybrid_infra_env")" == "$hybrid_infra_hash_before_failure" ]] || \
  fail 'failed hybrid rotation did not restore the infrastructure env'
[[ "$(sha256sum "$hybrid_native_env")" == "$hybrid_native_hash_before_failure" ]] || \
  fail 'failed hybrid rotation did not restore the native env'
! grep -Fq -- "$hybrid_new_infra_secret" "$fixture_root/expected.stderr" || \
  fail 'failed hybrid rotation logged the LiveKit secret'

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
