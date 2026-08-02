#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-cutover-test.XXXXXX")"
case "$test_root" in
  "${TMPDIR:-/tmp}"/openbmb-cutover-test.*) ;;
  *) printf 'unsafe Caddy cutover test directory\n' >&2; exit 1 ;;
esac
cleanup() {
  rm -rf -- "$test_root"
}
trap cleanup EXIT

fake_bin="$test_root/bin"
campus_dir="$test_root/campus"
install -d -m 0700 "$fake_bin" "$campus_dir"
printf 'services: {}\n' > "$campus_dir/compose.yml"
printf 'CAMPUS=true\n' > "$campus_dir/campus.env"
printf 'services: {}\n' > "$campus_dir/openbmb.override.yml"
printf 'test config\n' > "$test_root/Caddyfile"
cat > "$test_root/openbmb.env" <<'ENV'
OPENBMB_DOMAIN=sun227454.online
CAMPUSHUB_UPSTREAM=127.0.0.1:18080
LIVEKIT_SIGNAL_UPSTREAM=127.0.0.1:17880
MINIO_S3_UPSTREAM=127.0.0.1:19000
ENV
chmod 0600 "$test_root/openbmb.env"
cat > "$test_root/health-check.sh" <<'HEALTH'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${1:-}" == --public ]]
printf 'health\n' >> "${FAKE_CUTOVER_LOG:?}"
HEALTH
chmod 0700 "$test_root/health-check.sh"

cat > "$fake_bin/ss" <<'FAKE_SS'
#!/usr/bin/env bash
printf 'LISTEN 0 128 127.0.0.1:8080 0.0.0.0:*\n'
printf 'LISTEN 0 128 127.0.0.1:33306 0.0.0.0:*\n'
FAKE_SS
cat > "$fake_bin/caddy" <<'FAKE_CADDY'
#!/usr/bin/env bash
[[ "${1:-}" == validate ]]
[[ "${FAKE_CADDY_VALIDATE_FAIL:-false}" != true ]]
FAKE_CADDY
cat > "$fake_bin/sudo" <<'FAKE_SUDO'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == -u ]]; then
  shift 2
fi
exec "$@"
FAKE_SUDO
cat > "$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl %s\n' "$*" >> "${FAKE_CUTOVER_LOG:?}"
if [[ -n "${FAKE_CURL_FAIL_ONCE_FILE:-}" && ! -e "$FAKE_CURL_FAIL_ONCE_FILE" ]]; then
  : > "$FAKE_CURL_FAIL_ONCE_FILE"
  exit 56
fi
FAKE_CURL
cat > "$fake_bin/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
set -Eeuo pipefail
state_file="${FAKE_CADDY_ENABLE_STATE_FILE:?}"
if [[ "${1:-}" == is-enabled ]]; then
  state="$(<"$state_file")"
  printf '%s\n' "$state"
  [[ "$state" == enabled ]]
  exit
fi
printf 'systemctl %s\n' "$*" >> "${FAKE_CUTOVER_LOG:?}"
if [[ "${1:-}" == start && "${FAKE_SYSTEMCTL_START_FAIL:-false}" == true ]]; then
  exit 1
fi
if [[ "${1:-}" == enable ]]; then
  printf 'enabled\n' > "$state_file"
  if [[ "${FAKE_SIGNAL_ON_ENABLE:-}" == TERM ]]; then
    kill -TERM "$PPID"
    sleep 0.2
  fi
  if [[ "${FAKE_SYSTEMCTL_ENABLE_FAIL:-false}" == true ]]; then
    exit 1
  fi
fi
if [[ "${1:-}" == disable ]]; then
  printf 'disabled\n' > "$state_file"
fi
FAKE_SYSTEMCTL
cat > "$fake_bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${1:-}" == compose ]]
args=" $* "
has_override=false
if [[ "$args" == *' openbmb.override.yml '* ]]; then
  has_override=true
fi
if [[ "$args" == *' config --services '* ]]; then
  printf 'frontend\n'
elif [[ "$args" == *' config '* ]]; then
  printf 'services:\n  frontend: {}\n'
elif [[ "$args" == *' ps --format json '* ]]; then
  printf '[]\n'
elif [[ "$args" == *' port frontend 80 '* ]]; then
  if [[ "$has_override" == true ]]; then
    printf '127.0.0.1:18080\n'
  else
    printf '0.0.0.0:80\n'
  fi
elif [[ "$args" == *' up -d '* ]]; then
  if [[ "$has_override" == true ]]; then
    printf 'cutover\n' >> "${FAKE_CUTOVER_LOG:?}"
    if [[ "${FAKE_SIGNAL_ON_CUTOVER:-}" == TERM ]]; then
      kill -TERM "$PPID"
      sleep 0.2
    fi
  else
    printf 'restore\n' >> "${FAKE_CUTOVER_LOG:?}"
  fi
else
  printf 'unexpected fake docker call: %s\n' "$*" >&2
  exit 1
fi
FAKE_DOCKER
chmod 0700 "$fake_bin"/*

export PATH="$fake_bin:$PATH"
export OPENBMB_OPERATION_LOCK_HELD=true
export OPENBMB_CADDY_ENV_FILE="$test_root/openbmb.env"
export OPENBMB_CADDY_CONFIG_FILE="$test_root/Caddyfile"
export OPENBMB_CUTOVER_HEALTH_CHECK="$test_root/health-check.sh"
export FAKE_CADDY_ENABLE_STATE_FILE="$test_root/caddy-enable-state"
printf 'disabled\n' > "$FAKE_CADDY_ENABLE_STATE_FILE"

run_cutover() {
  local state_name="$1"
  export OPENBMB_CUTOVER_STATE_ROOT="$test_root/$state_name"
  bash "$script_dir/cutover-caddy.sh" \
    "$campus_dir" compose.yml campus.env openbmb.override.yml frontend
}

# Normal completion starts and enables Caddy without restoring the old public binding.
export FAKE_CUTOVER_LOG="$test_root/success.log"
export FAKE_CURL_FAIL_ONCE_FILE="$test_root/curl-failed-once"
run_cutover state-success >"$test_root/success.out" 2>"$test_root/success.err"
unset FAKE_CURL_FAIL_ONCE_FILE
grep -Fxq cutover "$FAKE_CUTOVER_LOG"
[[ "$(grep -c '^curl ' "$FAKE_CUTOVER_LOG")" -eq 2 ]]
grep -Fxq 'systemctl start caddy' "$FAKE_CUTOVER_LOG"
grep -Fxq health "$FAKE_CUTOVER_LOG"
grep -Fxq 'systemctl enable caddy' "$FAKE_CUTOVER_LOG"
! grep -Fxq restore "$FAKE_CUTOVER_LOG"
[[ "$(<"$FAKE_CADDY_ENABLE_STATE_FILE")" == enabled ]]

# TERM in the port-ownership window restores CampusHub on :80 and preserves signal status.
printf 'disabled\n' > "$FAKE_CADDY_ENABLE_STATE_FILE"
export FAKE_CUTOVER_LOG="$test_root/term.log"
export FAKE_SIGNAL_ON_CUTOVER=TERM
set +e
run_cutover state-term >"$test_root/term.out" 2>"$test_root/term.err"
term_status=$?
set -e
unset FAKE_SIGNAL_ON_CUTOVER
[[ "$term_status" -eq 143 ]]
grep -Fxq cutover "$FAKE_CUTOVER_LOG"
grep -Fxq 'systemctl stop caddy' "$FAKE_CUTOVER_LOG"
grep -Fxq restore "$FAKE_CUTOVER_LOG"
grep -Fxq 'systemctl disable caddy' "$FAKE_CUTOVER_LOG"
[[ "$(<"$FAKE_CADDY_ENABLE_STATE_FILE")" == disabled ]]

# An ordinary failure after rebinding has the same recovery path.
export FAKE_CUTOVER_LOG="$test_root/start-failure.log"
export FAKE_SYSTEMCTL_START_FAIL=true
if run_cutover state-start-failure >"$test_root/start-failure.out" 2>"$test_root/start-failure.err"; then
  printf 'cutover unexpectedly survived a Caddy start failure\n' >&2
  exit 1
fi
unset FAKE_SYSTEMCTL_START_FAIL
grep -Fxq 'systemctl stop caddy' "$FAKE_CUTOVER_LOG"
grep -Fxq restore "$FAKE_CUTOVER_LOG"
grep -Fxq 'systemctl disable caddy' "$FAKE_CUTOVER_LOG"

# A signal after enable succeeds and a partially failing enable both restore disabled state.
printf 'disabled\n' > "$FAKE_CADDY_ENABLE_STATE_FILE"
export FAKE_CUTOVER_LOG="$test_root/enable-signal.log"
export FAKE_SIGNAL_ON_ENABLE=TERM
set +e
run_cutover state-enable-signal >"$test_root/enable-signal.out" 2>"$test_root/enable-signal.err"
enable_signal_status=$?
set -e
unset FAKE_SIGNAL_ON_ENABLE
[[ "$enable_signal_status" -eq 143 ]]
grep -Fxq 'systemctl enable caddy' "$FAKE_CUTOVER_LOG"
grep -Fxq restore "$FAKE_CUTOVER_LOG"
grep -Fxq 'systemctl disable caddy' "$FAKE_CUTOVER_LOG"
[[ "$(<"$FAKE_CADDY_ENABLE_STATE_FILE")" == disabled ]]

printf 'disabled\n' > "$FAKE_CADDY_ENABLE_STATE_FILE"
export FAKE_CUTOVER_LOG="$test_root/enable-failure.log"
export FAKE_SYSTEMCTL_ENABLE_FAIL=true
if run_cutover state-enable-failure >"$test_root/enable-failure.out" 2>"$test_root/enable-failure.err"; then
  printf 'cutover unexpectedly survived a partial Caddy enable failure\n' >&2
  exit 1
fi
unset FAKE_SYSTEMCTL_ENABLE_FAIL
grep -Fxq restore "$FAKE_CUTOVER_LOG"
grep -Fxq 'systemctl disable caddy' "$FAKE_CUTOVER_LOG"
[[ "$(<"$FAKE_CADDY_ENABLE_STATE_FILE")" == disabled ]]

# A pre-mutation validation failure must not recreate or stop public services.
export FAKE_CUTOVER_LOG="$test_root/preflight-failure.log"
export FAKE_CADDY_VALIDATE_FAIL=true
if run_cutover state-preflight-failure >"$test_root/preflight-failure.out" 2>"$test_root/preflight-failure.err"; then
  printf 'cutover unexpectedly survived a Caddy validation failure\n' >&2
  exit 1
fi
unset FAKE_CADDY_VALIDATE_FAIL
[[ ! -s "$FAKE_CUTOVER_LOG" ]]

printf 'Caddy cutover signal fixtures: OK\n'
