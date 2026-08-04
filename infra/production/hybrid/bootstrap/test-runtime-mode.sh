#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
fixture_root="$(mktemp -d)"
trap 'rm -rf -- "$fixture_root"' EXIT

for required in \
  "$script_dir/bootstrap-lib.sh" \
  "$script_dir/openbmb-runtime-mode" \
  "$script_dir/openbmb-bootstrap-api-cutover"; do
  [[ -f "$required" ]] || {
    printf 'missing bootstrap runtime component: %s\n' "$required" >&2
    exit 1
  }
done

fail() {
  printf 'hybrid runtime test: %s\n' "$*" >&2
  exit 1
}

# Keep the operations contract visible in source control. These assertions
# complement the functional recovery cases below and catch accidental drift in
# the shared lock, durable journal, and boot ordering.
for candidate in \
  "$script_dir/bootstrap-lib.sh" \
  "$script_dir/install-hybrid-control-plane.sh" \
  "$script_dir/migrate-from-docker.sh" \
  "$script_dir/openbmb-bootstrap-api-cutover" \
  "$script_dir/openbmb-hybrid-health" \
  "$script_dir/openbmb-runtime-mode" \
  "$script_dir/openbmb-stack-control" \
  "$script_dir/openbmb-backup-control" \
  "$script_dir/openbmb-switch-api-upstream"; do
  bash -n "$candidate" || fail "bash syntax check failed: $candidate"
done

grep -Fq 'operation_lock="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"' \
  "$script_dir/migrate-from-docker.sh" || fail 'migration public lock changed'
grep -Fq 'operation_lock="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"' \
  "$script_dir/openbmb-runtime-mode" || fail 'runtime public lock changed'
grep -Fq 'export OPENBMB_OPERATION_LOCK_FD=9' \
  "$script_dir/migrate-from-docker.sh" || fail 'migration does not export its inherited lock descriptor'
grep -Fq 'hybrid_assert_inherited_lock "$operation_lock"' \
  "$script_dir/openbmb-runtime-mode" || fail 'runtime mode does not authenticate an inherited lock descriptor'
if grep -Fq 'native_operation_lock=' "$script_dir/migrate-from-docker.sh"; then
  fail 'migration must not substitute a private lock for the shared production lock'
fi
if grep -En '^[[:space:]]*chmod[[:space:]].*/run/lock' \
  "$script_dir"/*.sh "$script_dir"/openbmb-* >/dev/null; then
  fail 'bootstrap code must never chmod /run/lock'
fi
grep -Fq 'hybrid_atomic_commit_file "$temporary" "$journal"' \
  "$script_dir/openbmb-runtime-mode" || fail 'journal commit lost its fsync primitive'
grep -Fq 'hybrid_atomic_remove "$journal"' \
  "$script_dir/openbmb-runtime-mode" || fail 'journal removal lost its fsync primitive'
grep -Fq 'switch|stage)' "$script_dir/openbmb-switch-api-upstream" || \
  fail 'Caddy helper has no offline boot-recovery CAS'
grep -Fq '"$native_deploy" compatibility' "$script_dir/openbmb-runtime-mode" || \
  fail 'Docker-to-hybrid switch lacks native compatibility validation'
grep -Fq -- '-e "$native_pending" || -L "$native_pending"' \
  "$script_dir/openbmb-runtime-mode" || \
  fail 'runtime status does not surface an interrupted native API deployment'
grep -Fq '[[ "$journal_phase" == routed ]]' "$script_dir/openbmb-runtime-mode" || \
  fail 'bootstrap commit does not require a durably routed transition'
grep -Fq '[[ "$($upstream_helper current)" == "$journal_target_upstream" ]]' \
  "$script_dir/openbmb-runtime-mode" || \
  fail 'bootstrap commit does not prove the authoritative Caddy upstream'

recovery_unit="$script_dir/../../systemd/openbmb-hybrid-recovery.service"
caddy_recovery_dropin="$script_dir/../../systemd/caddy-openbmb-hybrid-recovery.conf"
stack_runtime_dropin="$script_dir/../../systemd/openbmb-hybrid.conf"
backup_runtime_dropin="$script_dir/../../systemd/openbmb-backup-hybrid.conf"
native_unit="$script_dir/../../systemd/openbmb-native-api@.service"
grep -Fq 'Before=caddy.service' "$recovery_unit" || fail 'boot recovery must precede Caddy'
if grep -Fq 'ConditionPathExists=' "$recovery_unit"; then
  fail 'boot recovery must run even when only the native API journal exists'
fi
grep -Fq 'TimeoutStartSec=600' "$recovery_unit" || \
  fail 'boot recovery timeout is shorter than its bounded health budget'
grep -Fq 'RemainAfterExit=yes' "$recovery_unit" || \
  fail 'recovery must remain active to prevent recursive Caddy-start recovery'
grep -Fq 'ExecStart=/usr/local/sbin/openbmb-web-release recover' "$recovery_unit" || \
  fail 'boot recovery does not reconcile the durable Web transition journal'
grep -Fq 'file:/var/lib/openbmb/web-release/transition.pending' "$recovery_unit" || \
  fail 'boot recovery does not document the Web transition journal'
grep -Fq 'Requires=openbmb-hybrid-recovery.service' "$caddy_recovery_dropin" || \
  fail 'Caddy must fail closed when hybrid recovery fails'
grep -Fq 'After=openbmb-hybrid-recovery.service' "$caddy_recovery_dropin" || \
  fail 'Caddy must wait for hybrid recovery to succeed'
grep -Fq 'openbmb.service' "$caddy_recovery_dropin" || \
  fail 'Caddy must wait for the runtime-aware stack boundary'
grep -Fq 'Before=openbmb-hybrid-recovery.service' "$stack_runtime_dropin" || \
  fail 'stateful Docker prerequisites must start before hybrid recovery'
grep -Fq 'Requires=docker.service openbmb.service' "$recovery_unit" || \
  fail 'hybrid recovery does not require the stateful prerequisite service'
grep -Fq 'After=network-online.target docker.service openbmb.service' "$native_unit" || \
  fail 'native API can race stateful infrastructure health on cold boot'
grep -Fq 'Wants=network-online.target docker.service openbmb.service' "$native_unit" || \
  fail 'native API no longer requests its cold-start prerequisites'
grep -Fq 'ExecStartPre=/usr/bin/systemctl is-active --quiet docker.service' "$native_unit" || \
  fail 'native API does not fail a cold start when Docker is inactive'
grep -Fq 'ExecStartPre=/usr/bin/systemctl is-active --quiet openbmb.service' "$native_unit" || \
  fail 'native API does not fail a cold start with unhealthy prerequisites'
if grep -Eq '^(Requires|Requisite|BindsTo|PartOf)=.*(docker|openbmb)\.service' "$native_unit"; then
  fail 'native API lifecycle is incorrectly bound to Docker/stack restarts'
fi
grep -Fq 'ExecStart=/usr/local/sbin/openbmb-stack-control start' "$stack_runtime_dropin" || \
  fail 'legacy stack start was not replaced by the runtime-aware adapter'
grep -Fq 'ExecStop=/usr/local/sbin/openbmb-stack-control stop' "$stack_runtime_dropin" || \
  fail 'legacy stack stop was not replaced by the runtime-aware adapter'
grep -Fq 'quiesce_docker_application' "$script_dir/openbmb-stack-control" || \
  fail 'hybrid stack adapter does not quiesce Docker API/Web containers'
grep -Fq 'mode=uninitialized\|upstream=127.0.0.1:13100' "$script_dir/openbmb-stack-control" || \
  fail 'pre-migration stack startup does not preserve the Docker application'
grep -Fq 'systemctl enable --now openbmb-hybrid-recovery.service' \
  "$script_dir/install-hybrid-control-plane.sh" || \
  fail 'installer does not activate the current-boot recovery barrier'
grep -Fq '/etc/systemd/system/openbmb.service 0444' \
  "$script_dir/install-hybrid-control-plane.sh" || \
  fail 'installer does not provide the runtime-aware stack base unit'
grep -Fq '"$runtime_mode" switch docker' "$script_dir/openbmb-backup-control" || \
  fail 'hybrid backup does not enter the proven Docker snapshot boundary'
grep -Fq '"$runtime_mode" switch hybrid' "$script_dir/openbmb-backup-control" || \
  fail 'hybrid backup does not restore its initial runtime mode'
grep -Fq 'ExecStart=/usr/local/sbin/openbmb-backup-control' "$backup_runtime_dropin" || \
  fail 'backup service is not routed through the hybrid-aware adapter'
grep -Fq 'ExecStopPost=/usr/local/sbin/openbmb-stack-control reload' "$backup_runtime_dropin" || \
  fail 'backup post-action can bypass the runtime-aware stack adapter'

expected_uid="$(id -u)"
expected_gid="$(id -g)"
export OPENBMB_EXPECTED_UID="$expected_uid"
export OPENBMB_EXPECTED_GID="$expected_gid"
export OPENBMB_SYNC_BIN=true

# shellcheck source=bootstrap-lib.sh
source "$script_dir/bootstrap-lib.sh"

lock_parent="$fixture_root/shared-lock"
mkdir "$lock_parent"
parent_mode_before="$(stat -c %a "$lock_parent")"
hybrid_prepare_lock_file "$lock_parent/openbmb-operation.lock"
[[ "$(stat -c %a "$lock_parent")" == "$parent_mode_before" ]]
[[ -f "$lock_parent/openbmb-operation.lock" && ! -L "$lock_parent/openbmb-operation.lock" ]]
if command -v flock >/dev/null 2>&1; then
  exec 8<>"$lock_parent/openbmb-operation.lock"
  flock -n 8
  hybrid_assert_inherited_lock "$lock_parent/openbmb-operation.lock" 8 flock
fi
printf 'sentinel\n' >"$fixture_root/sentinel"
ln -s "$fixture_root/sentinel" "$lock_parent/hostile.lock"
if [[ -L "$lock_parent/hostile.lock" ]]; then
  if (hybrid_prepare_lock_file "$lock_parent/hostile.lock") 2>/dev/null; then
    printf 'symlink lock was accepted\n' >&2
    exit 1
  fi
  [[ "$(cat "$fixture_root/sentinel")" == sentinel ]]
fi

mock_bin="$fixture_root/bin"
mock_state="$fixture_root/mock-state"
mkdir "$mock_bin" "$mock_state"
export FIXTURE_STATE="$mock_state"

cat >"$mock_bin/flock" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat >"$mock_bin/install" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == -d ]]; then
  shift
  directories=()
  while (($#)); do
    case "$1" in
      -o|-g|-m) shift 2 ;;
      *) directories+=("$1"); shift ;;
    esac
  done
  mkdir -p -- "${directories[@]}"
  exit 0
fi
exec /usr/bin/install "$@"
MOCK
cat >"$mock_bin/chown" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat >"$mock_bin/chmod" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat >"$mock_bin/sync" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
cat >"$mock_bin/caddy" <<'MOCK'
#!/usr/bin/env bash
printf 'caddy %s\n' "$*" >>"$FIXTURE_STATE/calls"
exit 0
MOCK
cat >"$mock_bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >>"$FIXTURE_STATE/calls"
unit_state_path() {
  local unit="$1" state="$2" key
  key="${unit//[^A-Za-z0-9]/_}"
  printf '%s/unit-%s.%s\n' "$FIXTURE_STATE" "$key" "$state"
}
case "$1" in
  is-active)
    case "${3:-${2:-}}" in
      caddy) [[ -f "$FIXTURE_STATE/caddy-active" ]] ;;
      openbmb.service|openbmb-hybrid-recovery.service)
        [[ ! -f "$FIXTURE_STATE/barriers-inactive" ]]
        ;;
      *) exit 3 ;;
    esac
    exit $?
    ;;
  show)
    [[ "$#" -eq 4 && "$3" == --value ]] || exit 2
    case "$2" in
      --property=LoadState) printf 'loaded\n' ;;
      --property=ActiveState)
        [[ -f "$(unit_state_path "$4" active)" ]] && printf 'active\n' || printf 'inactive\n'
        ;;
      --property=UnitFileState)
        [[ -f "$(unit_state_path "$4" enabled)" ]] && printf 'enabled\n' || printf 'disabled\n'
        ;;
      *) exit 2 ;;
    esac
    ;;
  enable)
    if [[ "${2:-}" == --now ]]; then unit="${3:-}"; else unit="${2:-}"; fi
    touch "$(unit_state_path "$unit" enabled)"
    [[ "${2:-}" != --now ]] || touch "$(unit_state_path "$unit" active)"
    ;;
  disable)
    [[ "${2:-}" == --now && -n "${3:-}" ]] || exit 2
    unit="$3"
    if [[ -f "$(unit_state_path "$unit" fail-disable)" ]]; then exit 1; fi
    rm -f "$(unit_state_path "$unit" enabled)" "$(unit_state_path "$unit" active)"
    ;;
  restart)
    touch "$(unit_state_path "${2:-}" active)"
    ;;
  reload)
    if [[ -f "$FIXTURE_STATE/fail-next-reload" ]]; then
      rm -f "$FIXTURE_STATE/fail-next-reload"
      exit 1
    fi
    touch "$FIXTURE_STATE/caddy-active"
    ;;
  start)
    if [[ "${2:-}" == caddy ]]; then
      touch "$FIXTURE_STATE/caddy-active"
    elif [[ -n "${2:-}" ]]; then
      touch "$(unit_state_path "$2" active)"
    fi
    ;;
  stop)
    if [[ "${2:-}" == caddy ]]; then
      rm -f "$FIXTURE_STATE/caddy-active"
    elif [[ -n "${2:-}" ]]; then
      rm -f "$(unit_state_path "$2" active)"
    fi
    ;;
esac
exit 0
MOCK
cat >"$mock_bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >>"$FIXTURE_STATE/calls"
case "$1" in
  inspect)
    template="$3"
    container="$4"
    state_file="$FIXTURE_STATE/$container"
    case "$template" in
      *State.Running*) [[ -f "$state_file" ]] && printf 'true\n' || printf 'false\n' ;;
      *State.Health.Status*)
        if [[ -f "$FIXTURE_STATE/docker-health-starting" ]]; then
          count="$(cat "$FIXTURE_STATE/docker-health-count" 2>/dev/null || printf 0)"
          count=$((count + 1))
          printf '%s\n' "$count" >"$FIXTURE_STATE/docker-health-count"
          if [[ "$count" -lt 3 ]]; then
            printf 'starting\n'
          else
            rm -f "$FIXTURE_STATE/docker-health-starting"
            printf 'healthy\n'
          fi
        elif [[ -f "$state_file" ]]; then
          printf 'healthy\n'
        else
          printf 'unhealthy\n'
        fi
        ;;
      *Config.Image*) printf 'openbmb-api:git-0123456789ab\n' ;;
    esac
    ;;
  stop)
    for value in "$@"; do
      case "$value" in openbmb-*) rm -f "$FIXTURE_STATE/$value" ;; esac
    done
    ;;
  rm) ;;
esac
exit 0
MOCK
cat >"$mock_bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"$FIXTURE_STATE/calls"
exit 0
MOCK
cat >"$mock_bin/native-deploy" <<'MOCK'
#!/usr/bin/env bash
fd="${OPENBMB_OPERATION_LOCK_FD:-}"
[[ "${OPENBMB_OPERATION_LOCK_HELD:-}" == true ]]
[[ "$fd" =~ ^([3-9]|[1-9][0-9]+)$ && -e "/proc/$$/fd/$fd" ]]
[[ "$(stat -Lc %d:%i -- "/proc/$$/fd/$fd")" == \
   "$(stat -Lc %d:%i -- "$OPENBMB_OPERATION_LOCK")" ]]
printf 'native-deploy %s\n' "$*" >>"$FIXTURE_STATE/calls"
printf 'native-boot %s\n' "${OPENBMB_NATIVE_API_BOOT_RECOVERY:-false}" >>"$FIXTURE_STATE/calls"
exit 0
MOCK
cat >"$mock_bin/compose.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'compose %s\n' "$*" >>"$FIXTURE_STATE/calls"
for value in "$@"; do
  case "$value" in
    api) touch "$FIXTURE_STATE/openbmb-api" ;;
    client-web) touch "$FIXTURE_STATE/openbmb-client-web" ;;
    admin-web) touch "$FIXTURE_STATE/openbmb-admin-web" ;;
  esac
done
MOCK
cat >"$mock_bin/upstream-helper" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  current) sed -n 's/^OPENBMB_API_UPSTREAM=//p' "$OPENBMB_CADDY_ENV_FILE" ;;
  *) exit 2 ;;
esac
MOCK
cat >"$mock_bin/docker-health-transition" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == inspect && "$2" == --format ]] || exit 2
count="$(cat "$FIXTURE_STATE/health-inspect-count" 2>/dev/null || printf 0)"
count=$((count + 1))
printf '%s\n' "$count" >"$FIXTURE_STATE/health-inspect-count"
if [[ "$count" -le 6 ]]; then printf 'true|starting\n'; else printf 'true|healthy\n'; fi
MOCK
chmod 0700 "$mock_bin"/*
export PATH="$mock_bin:$PATH"

# Cold boot commonly reports `starting` immediately after Compose returns.
# The stack boundary must poll to healthy rather than fail its systemd job.
(
  # shellcheck source=openbmb-stack-control
  source "$script_dir/openbmb-stack-control"
  docker_bin="$mock_bin/docker-health-transition"
  OPENBMB_INFRA_HEALTH_ATTEMPTS=3
  OPENBMB_INFRA_HEALTH_INTERVAL_SECONDS=0
  wait_infrastructure_health
)
[[ "$(cat "$mock_state/health-inspect-count")" -eq 12 ]]

runtime_fixture="$fixture_root/runtime"
state_root="$runtime_fixture/state"
caddy_root="$runtime_fixture/caddy"
lock_root="$runtime_fixture/locks"
api_release_root="$runtime_fixture/api-releases"
api_slots_root="$runtime_fixture/api-slots"
web_release_root="$runtime_fixture/web-releases"
mkdir -p \
  "$state_root/configs/docker" "$state_root/configs/hybrid" "$caddy_root" "$lock_root" \
  "$api_release_root/git-0123456789ab" "$api_slots_root" "$web_release_root"
printf 'docker config\n' >"$state_root/configs/docker/Caddyfile"
printf 'OPENBMB_API_UPSTREAM=127.0.0.1:13100\n' >"$state_root/configs/docker/openbmb.env"
printf 'hybrid config\n' >"$state_root/configs/hybrid/Caddyfile"
printf 'OPENBMB_API_UPSTREAM=127.0.0.1:13101\n' >"$state_root/configs/hybrid/openbmb.env"
chmod 0600 "$state_root/configs"/{docker,hybrid}/*
ln -s "$api_release_root/git-0123456789ab" "$runtime_fixture/current-api"
ln -s "$api_release_root/git-0123456789ab" "$api_slots_root/blue"

export OPENBMB_BOOTSTRAP_LIB="$script_dir/bootstrap-lib.sh"
export OPENBMB_HYBRID_MODE_STATE="$state_root"
export OPENBMB_OPERATION_LOCK="$lock_root/openbmb-operation.lock"
export OPENBMB_NATIVE_API_OPERATION_LOCK="$state_root/native-api-operation.lock"
export OPENBMB_FLOCK_BIN="$mock_bin/flock"
export OPENBMB_SYNC_BIN="$mock_bin/sync"
export OPENBMB_CADDY_BIN="$mock_bin/caddy"
export OPENBMB_SYSTEMCTL_BIN="$mock_bin/systemctl"
export OPENBMB_DOCKER_BIN="$mock_bin/docker"
export OPENBMB_CURL_BIN="$mock_bin/curl"
export OPENBMB_NATIVE_API_DEPLOY="$mock_bin/native-deploy"
export OPENBMB_NATIVE_API_PENDING="$state_root/native-api.pending"
export OPENBMB_COMPOSE_SCRIPT="$mock_bin/compose.sh"
export OPENBMB_API_UPSTREAM_HELPER="$mock_bin/upstream-helper"
export OPENBMB_CADDY_FILE="$caddy_root/Caddyfile"
export OPENBMB_CADDY_ENV_FILE="$caddy_root/openbmb.env"
export OPENBMB_CADDY_GROUP="$expected_gid"
export OPENBMB_CURRENT_API_LINK="$runtime_fixture/current-api"
export OPENBMB_NATIVE_API_RELEASES_ROOT="$api_release_root"
export OPENBMB_NATIVE_API_SLOTS_ROOT="$api_slots_root"
export OPENBMB_WEB_RELEASES_ROOT="$web_release_root"
export OPENBMB_HEALTH_ATTEMPTS=1

write_pending() {
  local operation="$1" phase="$2" previous="$3" target="$4" previous_upstream="$5" target_upstream="$6"
  cat >"$state_root/transition.pending" <<EOF
version=1
operation=$operation
phase=$phase
previous_mode=$previous
target_mode=$target
previous_upstream=$previous_upstream
target_upstream=$target_upstream
cleanup_native=false
EOF
  chmod 0600 "$state_root/transition.pending"
}

# A failed Caddy reload must not prevent the independent Docker recovery path.
printf 'docker\n' >"$state_root/mode"
chmod 0600 "$state_root/mode"
cp "$state_root/configs/hybrid/Caddyfile" "$caddy_root/Caddyfile"
cp "$state_root/configs/hybrid/openbmb.env" "$caddy_root/openbmb.env"
chmod 0644 "$caddy_root/Caddyfile"
chmod 0640 "$caddy_root/openbmb.env"
touch "$mock_state/caddy-active" "$mock_state/fail-next-reload"
rm -f "$mock_state/openbmb-api" "$mock_state/calls"
write_pending switch-hybrid caddy-staged docker hybrid 127.0.0.1:13100 127.0.0.1:13101
"$script_dir/openbmb-runtime-mode" recover
[[ "$(cat "$state_root/mode")" == docker ]]
[[ ! -e "$state_root/transition.pending" ]]
[[ -f "$mock_state/openbmb-api" ]]
grep -Fq 'systemctl stop caddy' "$mock_state/calls"
grep -Fq 'systemctl is-active --quiet openbmb.service' "$mock_state/calls"
grep -Fq 'systemctl is-active --quiet openbmb-hybrid-recovery.service' "$mock_state/calls"
grep -Fq 'systemctl start caddy' "$mock_state/calls"
grep -Eq '^compose .* api ' "$mock_state/calls"
compose_line="$(grep -nE '^compose .* api ' "$mock_state/calls" | head -n 1 | cut -d: -f1)"
native_recover_line="$(grep -nF 'native-deploy recover' "$mock_state/calls" | head -n 1 | cut -d: -f1)"
[[ -n "$compose_line" && -n "$native_recover_line" && "$compose_line" -lt "$native_recover_line" ]] || \
  fail 'Docker API must be restored before ordinary native recovery'

# The stable public interface must return from hybrid to the retained Docker
# current-app path and leave both direct and public health checks successful.
printf 'hybrid\n' >"$state_root/mode"
cp "$state_root/configs/hybrid/Caddyfile" "$caddy_root/Caddyfile"
cp "$state_root/configs/hybrid/openbmb.env" "$caddy_root/openbmb.env"
chmod 0644 "$caddy_root/Caddyfile"
chmod 0640 "$caddy_root/openbmb.env"
touch "$mock_state/caddy-active"
rm -f "$mock_state/openbmb-api" "$mock_state/calls" "$mock_state/docker-health-count"
touch "$mock_state/docker-health-starting"
export OPENBMB_HEALTH_ATTEMPTS=4
export OPENBMB_HEALTH_INTERVAL_SECONDS=0
"$script_dir/openbmb-runtime-mode" switch docker
[[ "$(cat "$state_root/mode")" == docker ]]
[[ -f "$mock_state/openbmb-api" ]]
[[ ! -e "$state_root/transition.pending" ]]
[[ "$(cat "$mock_state/docker-health-count")" -eq 3 ]]
grep -Eq '^compose .* api ' "$mock_state/calls"
grep -Fq 'systemctl disable --now openbmb-native-api@blue.service' "$mock_state/calls"

# Repeating a request for the healthy current mode is a no-op success, not an
# operator error and not a second Compose mutation.
compose_count_before="$(grep -c '^compose ' "$mock_state/calls" || true)"
"$script_dir/openbmb-runtime-mode" switch docker
compose_count_after="$(grep -c '^compose ' "$mock_state/calls" || true)"
[[ "$compose_count_after" == "$compose_count_before" ]] || fail 'idempotent Docker switch reran Compose'
[[ "$(cat "$state_root/mode")" == docker && ! -e "$state_root/transition.pending" ]]

# Boot rollback must restore both the active and enabled state. Otherwise a
# crash after disable --now appears recovered once but fails at the next boot.
printf 'hybrid\n' >"$state_root/mode"
cp "$state_root/configs/hybrid/Caddyfile" "$caddy_root/Caddyfile"
cp "$state_root/configs/hybrid/openbmb.env" "$caddy_root/openbmb.env"
chmod 0644 "$caddy_root/Caddyfile"
chmod 0640 "$caddy_root/openbmb.env"
rm -f "$mock_state/calls"
write_pending switch-docker caddy-staged hybrid docker 127.0.0.1:13101 none
"$script_dir/openbmb-runtime-mode" recover --boot
[[ "$(cat "$state_root/mode")" == hybrid && ! -e "$state_root/transition.pending" ]]
grep -Fq 'systemctl enable --now openbmb-native-api@blue.service' "$mock_state/calls"
grep -Fq 'systemctl show --property=ActiveState --value openbmb-native-api@blue.service' \
  "$mock_state/calls"
grep -Fq 'systemctl show --property=UnitFileState --value openbmb-native-api@blue.service' \
  "$mock_state/calls"

# An online operation must fail before writing a journal when starting Caddy
# could recursively pull an inactive stack/recovery dependency onto this lock.
rm -f "$mock_state/caddy-active" "$mock_state/calls"
touch "$mock_state/barriers-inactive"
if "$script_dir/openbmb-runtime-mode" switch docker >/dev/null 2>&1; then
  sed 's/^/barrier-debug: /' "$mock_state/calls" >&2
  fail 'online switch accepted inactive runtime barriers'
fi
[[ "$(cat "$state_root/mode")" == hybrid && ! -e "$state_root/transition.pending" ]]
! grep -Fq 'systemctl start caddy' "$mock_state/calls"
rm -f "$mock_state/barriers-inactive"

# A normal native deployment has no runtime journal. Boot recovery must still
# consume its distinct journal with the authenticated shared-lock descriptor.
rm -f "$mock_state/calls"
touch "$state_root/native-api.pending"
"$script_dir/openbmb-runtime-mode" recover --boot
grep -Fq 'native-deploy recover' "$mock_state/calls"
grep -Fq 'native-boot true' "$mock_state/calls"
rm -f "$state_root/native-api.pending"

# Even without a journal, the boot barrier must prove the selected slot is
# enabled+healthy and the inactive slot is disabled+inactive before Caddy.
rm -f "$mock_state/calls"
[[ "$(cat "$state_root/mode")" == hybrid ]] || fail 'steady-state fixture mode drifted'
[[ "$("$mock_bin/upstream-helper" current)" == 127.0.0.1:13101 ]] || \
  fail 'steady-state fixture upstream drifted'
current_fixture_target="$(readlink -f "$runtime_fixture/current-api" 2>/dev/null || true)"
blue_fixture_target="$(readlink -f "$api_slots_root/blue" 2>/dev/null || true)"
if [[ -L "$runtime_fixture/current-api" && -L "$api_slots_root/blue" && \
      -n "$current_fixture_target" && "$current_fixture_target" == "$blue_fixture_target" ]]; then
  "$script_dir/openbmb-runtime-mode" recover --boot
  grep -Fq 'systemctl enable --now openbmb-native-api@blue.service' "$mock_state/calls"
  grep -Fq 'systemctl disable --now openbmb-native-api@green.service' "$mock_state/calls"
  grep -Fq 'curl --fail --silent --show-error --connect-timeout 2 --max-time 6 http://127.0.0.1:13101/openBMB/api/v1/health/ready' \
    "$mock_state/calls"

  # Pointer/upstream disagreement is a hard boot failure.
  sed 's/13101/13102/' "$state_root/configs/hybrid/openbmb.env" >"$caddy_root/openbmb.env"
  chmod 0640 "$caddy_root/openbmb.env"
  if "$script_dir/openbmb-runtime-mode" recover --boot >/dev/null 2>&1; then
    fail 'settled hybrid recovery accepted a mismatched slot pointer'
  fi
  cp "$state_root/configs/hybrid/openbmb.env" "$caddy_root/openbmb.env"
  chmod 0640 "$caddy_root/openbmb.env"

  # Settled Docker boot proves direct health and quiesces both native slots.
  printf 'docker\n' >"$state_root/mode"
  cp "$state_root/configs/docker/openbmb.env" "$caddy_root/openbmb.env"
  chmod 0640 "$caddy_root/openbmb.env"
  touch "$mock_state/openbmb-api"
  rm -f "$mock_state/calls"
  "$script_dir/openbmb-runtime-mode" recover --boot
  grep -Fq 'systemctl disable --now openbmb-native-api@blue.service' "$mock_state/calls"
  grep -Fq 'systemctl disable --now openbmb-native-api@green.service' "$mock_state/calls"

  # The installer-to-migration window records no mode yet but must retain the
  # same healthy Docker boundary across a reboot.
  rm -f "$state_root/mode" "$mock_state/calls"
  "$script_dir/openbmb-runtime-mode" recover --boot
  grep -Fq 'systemctl disable --now openbmb-native-api@blue.service' "$mock_state/calls"
  grep -Fq 'systemctl disable --now openbmb-native-api@green.service' "$mock_state/calls"
else
  printf 'SKIP: settled pointer recovery requires native POSIX symlinks\n' >&2
fi

printf 'hybrid runtime recovery tests passed\n'
