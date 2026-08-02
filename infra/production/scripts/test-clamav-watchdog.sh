#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
watchdog="$script_dir/clamav-watchdog.sh"
fixture_root="$(mktemp -d -- /tmp/openbmb-watchdog-fixture.XXXXXX)"
case_roots=()
cleanup() {
  local case_root
  for case_root in "${case_roots[@]}"; do
    rm -rf -- "$case_root"
  done
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT
mock_bin="$fixture_root/bin"
mkdir -- "$mock_bin"

cat >"$mock_bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail

joined=" $* "
case "${1:-}" in
  container)
    exit 0
    ;;
  inspect)
    if [[ "$joined" == *com.docker.compose.project* ]]; then
      printf '%s\n' "${WATCHDOG_TEST_PROJECT_LABEL:-openbmb}"
    elif [[ "$joined" == *com.docker.compose.service* ]]; then
      printf '%s\n' "${WATCHDOG_TEST_SERVICE_LABEL:-clamav}"
    else
      printf '%s\n' "${WATCHDOG_TEST_HEALTH:-healthy}"
    fi
    ;;
  exec)
    if [[ "$joined" == *'/proc/[0-9]*/comm'* ]]; then
      [[ "${WATCHDOG_TEST_FRESHCLAM:-running}" == running ]]
    elif [[ "$joined" == *'sigtool --info'* ]]; then
      disk_epoch="$(date +%s)"
      if [[ "${WATCHDOG_TEST_STALE:-false}" == true ]]; then
        disk_epoch=$((disk_epoch - 400000))
      fi
      printf '12345 %s\n' "$disk_epoch"
    else
      exit 1
    fi
    ;;
  compose)
    printf '%s\n' "$*" >>"$WATCHDOG_TEST_EVENTS"
    if [[ "$joined" == *' --force-recreate clamav '* ]]; then
      : >"$WATCHDOG_TEST_RECONCILED"
      [[ "${WATCHDOG_TEST_RECONCILE_FAIL:-false}" != true ]]
    fi
    ;;
  stop)
    printf 'docker-stop %s\n' "$*" >>"$WATCHDOG_TEST_EVENTS"
    ;;
  *)
    printf 'unexpected docker mock invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
MOCK

cat >"$mock_bin/timeout" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail

joined=" $* "
last_argument="${!#}"
if [[ "$joined" == *zVERSION* ]]; then
  loaded_version="${WATCHDOG_TEST_LOADED_VERSION:-12345}"
  if [[ -f "$WATCHDOG_TEST_RECONCILED" ]]; then
    loaded_version="${WATCHDOG_TEST_RECOVERED_VERSION:-12345}"
  fi
  loaded_epoch="$(date +%s)"
  if [[ "${WATCHDOG_TEST_STALE:-false}" == true ]]; then
    loaded_epoch=$((loaded_epoch - 400000))
  fi
  loaded_date="$(LC_ALL=C date --date="@$loaded_epoch" '+%a %b %e %T %Y')"
  printf 'ClamAV 1.4.5/%s/%s' "$loaded_version" "$loaded_date"
elif [[ "$last_argument" == ping ]]; then
  printf 'PONG'
else
  printf 'stream: OK'
fi
MOCK

cat >"$mock_bin/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x -- "$mock_bin/docker" "$mock_bin/timeout" "$mock_bin/sleep"

new_case() {
  local name="$1"
  case_state="$(mktemp -d -- "/tmp/openbmb-watchdog-test.${name}.XXXXXX")"
  case_roots+=("$case_state")
  case_events="$case_state/events"
  case_reconciled="$case_state/reconciled"
  case_output="$case_state/output"
  case_infra_env="$case_state/infra.env"
  case_api_env="$case_state/api.env"
  printf 'CLAMAV_HOST_PORT=13310\n' >"$case_infra_env"
  printf 'CLAMAV_HOST=127.0.0.1\nCLAMAV_PORT=13310\n' >"$case_api_env"
}

run_watchdog() {
  env \
    PATH="$mock_bin:$PATH" \
    OPENBMB_OPERATION_LOCK_HELD=true \
    OPENBMB_WATCHDOG_SELF_TEST=true \
    OPENBMB_WATCHDOG_TEST_STATE_DIR="$case_state" \
    OPENBMB_INFRA_ENV_FILE="$case_infra_env" \
    OPENBMB_API_ENV_FILE="$case_api_env" \
    WATCHDOG_TEST_EVENTS="$case_events" \
    WATCHDOG_TEST_RECONCILED="$case_reconciled" \
    "$@" \
    bash "$watchdog" >"$case_output" 2>&1
}

new_case healthy
run_watchdog
grep -Fq 'HEALTHY: ClamAV engine' "$case_output"
[[ ! -s "$case_events" ]]

new_case drift
run_watchdog \
  WATCHDOG_TEST_LOADED_VERSION=12344 \
  WATCHDOG_TEST_RECOVERED_VERSION=12345
grep -Fq 'RECOVERED: ClamAV engine' "$case_output"
grep -Fq -- '--force-recreate clamav' "$case_events"
! grep -Fq ' stop ' "$case_events"

new_case stale
if run_watchdog WATCHDOG_TEST_STALE=true; then
  printf 'stale signatures unexpectedly passed watchdog attestation\n' >&2
  exit 1
fi
grep -Fq -- '--force-recreate clamav' "$case_events"
grep -Fq ' stop ' "$case_events"
grep -Fq 'daily signatures exceed 72 hours' "$case_output"

: >"$case_events"
rm -f -- "$case_reconciled"
if run_watchdog WATCHDOG_TEST_STALE=true; then
  printf 'recovery cooldown unexpectedly passed watchdog attestation\n' >&2
  exit 1
fi
grep -Fq 'recovery is cooling down' "$case_output"
! grep -Fq -- '--force-recreate clamav' "$case_events"
grep -Fq ' stop ' "$case_events"

new_case reconcile_failure
if run_watchdog \
  WATCHDOG_TEST_LOADED_VERSION=12344 \
  WATCHDOG_TEST_RECONCILE_FAIL=true; then
  printf 'failed ClamAV reconciliation unexpectedly passed\n' >&2
  exit 1
fi
grep -Fq 'reconciliation failed' "$case_output"
grep -Fq ' stop ' "$case_events"

new_case foreign_container
if run_watchdog WATCHDOG_TEST_PROJECT_LABEL=foreign; then
  printf 'foreign openbmb-clamav container unexpectedly passed ownership checks\n' >&2
  exit 1
fi
grep -Fq 'docker-stop' "$case_events"

unsafe_state="$(mktemp -d -- /tmp/openbmb-watchdog-test.symlink.XXXXXX)"
case_roots+=("$unsafe_state")
rm -rf -- "$unsafe_state"
ln -s -- /tmp "$unsafe_state"
case_state="$unsafe_state"
case_events="$fixture_root/symlink-events"
case_reconciled="$fixture_root/symlink-reconciled"
case_output="$fixture_root/symlink-output"
case_infra_env="$fixture_root/symlink-infra.env"
case_api_env="$fixture_root/symlink-api.env"
printf 'CLAMAV_HOST_PORT=13310\n' >"$case_infra_env"
printf 'CLAMAV_HOST=127.0.0.1\nCLAMAV_PORT=13310\n' >"$case_api_env"
if run_watchdog; then
  printf 'symbolic-link watchdog state unexpectedly passed\n' >&2
  exit 1
fi
grep -Fq 'must not be a symbolic link' "$case_output"
rm -- "$unsafe_state"

printf 'ClamAV watchdog fixtures: OK\n'
