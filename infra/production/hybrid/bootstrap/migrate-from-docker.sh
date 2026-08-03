#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
bootstrap_lib="${OPENBMB_BOOTSTRAP_LIB:-/usr/local/libexec/openbmb-hybrid/bootstrap-lib.sh}"
if [[ ! -f "$bootstrap_lib" && -f "$script_dir/bootstrap-lib.sh" ]]; then
  bootstrap_lib="$script_dir/bootstrap-lib.sh"
fi
# shellcheck source=bootstrap-lib.sh
source "$bootstrap_lib"

domain=''
expected_current_app=''
api_artifact=''
api_sha256=''
caddy_source=''
caddy_file="${OPENBMB_CADDY_FILE:-/etc/caddy/Caddyfile}"
caddy_env="${OPENBMB_CADDY_ENV_FILE:-/etc/caddy/openbmb.env}"
runtime_state="${OPENBMB_HYBRID_MODE_STATE:-/var/lib/openbmb/hybrid-runtime}"
evidence_root="${OPENBMB_HYBRID_BOOTSTRAP_EVIDENCE:-/var/lib/openbmb/hybrid-bootstrap}"
operation_lock="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"
flock_bin="${OPENBMB_FLOCK_BIN:-flock}"
runtime_mode="${OPENBMB_RUNTIME_MODE_BIN:-/usr/local/sbin/openbmb-runtime-mode}"
cutover_helper="${OPENBMB_BOOTSTRAP_CUTOVER_HELPER:-/usr/local/libexec/openbmb-bootstrap-api-cutover}"
native_deploy="${OPENBMB_NATIVE_API_DEPLOY:-/usr/local/sbin/openbmb-deploy-native-api}"
hybrid_health="${OPENBMB_HYBRID_HEALTH_BIN:-/usr/local/sbin/openbmb-hybrid-health}"
upstream_helper="${OPENBMB_API_UPSTREAM_HELPER:-/usr/local/libexec/openbmb-switch-api-upstream}"
stack_control="${OPENBMB_STACK_CONTROL_BIN:-/usr/local/sbin/openbmb-stack-control}"
systemctl_bin="${OPENBMB_SYSTEMCTL_BIN:-systemctl}"
docker_bin="${OPENBMB_DOCKER_BIN:-docker}"
curl_bin="${OPENBMB_CURL_BIN:-curl}"
caddy_bin="${OPENBMB_CADDY_BIN:-caddy}"
current_app="${OPENBMB_CURRENT_APP_LINK:-/opt/openbmb/current-app}"
current_api="${OPENBMB_CURRENT_API_LINK:-/opt/openbmb/current-api}"
releases_root="${OPENBMB_STACK_RELEASES_ROOT:-/opt/openbmb/releases}"
transaction_root=''
transition_started=false
migration_complete=false
artifact_name=''
staged_artifact=''
staged_sidecar=''

fail() {
  printf 'HYBRID MIGRATION: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --expected-current-app) expected_current_app="${2:-}"; shift 2 ;;
    --api-artifact) api_artifact="${2:-}"; shift 2 ;;
    --api-sha256) api_sha256="${2:-}"; shift 2 ;;
    --caddyfile) caddy_source="${2:-}"; shift 2 ;;
    *) fail "unknown or incomplete option: $1" ;;
  esac
done

hybrid_require_root || exit 1
[[ "$domain" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || \
  fail 'domain must be a DNS hostname'
[[ "$expected_current_app" =~ ^git-[0-9a-f]{12}$ ]] || \
  fail 'expected-current-app must be an immutable git-* release ID'
export OPENBMB_DOMAIN="$domain"

# The shared production lock is opened without truncation only after proving
# its sticky parent and root-owned regular-file identity. It remains held from
# the first mutable check until the final durable mode commit.
hybrid_prepare_lock_file "$operation_lock"
exec 9<>"$operation_lock"
"$flock_bin" --exclusive --wait 0 --conflict-exit-code 75 9 || \
  fail 'another production operation is active'
export OPENBMB_OPERATION_LOCK_HELD=true
export OPENBMB_OPERATION_LOCK="$operation_lock"
export OPENBMB_OPERATION_LOCK_FD=9

for installed in \
  "$runtime_mode" "$cutover_helper" "$native_deploy" "$hybrid_health" "$upstream_helper" "$stack_control"; do
  [[ -x "$installed" && ! -L "$installed" ]] || fail "hybrid control is not safely installed: $installed"
  [[ "$(stat -c %u -- "$installed")" == "$hybrid_expected_uid" ]] || fail "hybrid control owner is unsafe: $installed"
  if find "$installed" -maxdepth 0 -perm /0022 -print -quit | grep -q .; then
    fail "hybrid control is writable by group/other: $installed"
  fi
done

install -d -o "$hybrid_expected_uid" -g "${OPENBMB_EXPECTED_GID:-0}" -m 0700 \
  "$evidence_root" "$runtime_state" "$runtime_state/configs" \
  "$runtime_state/configs/docker" "$runtime_state/configs/hybrid"
hybrid_assert_root_directory "$evidence_root"
hybrid_assert_root_directory "$runtime_state"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
transaction_root="$evidence_root/$stamp-$$"
install -d -o "$hybrid_expected_uid" -g "${OPENBMB_EXPECTED_GID:-0}" -m 0700 "$transaction_root"
hybrid_assert_root_directory "$transaction_root"

# Pin every caller-controlled path to a stable root-owned inode before any
# validation or service mutation. The active pair is pinned for forensic and
# manual recovery evidence as well.
artifact_name="$(basename -- "$api_artifact")"
[[ "$artifact_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail 'API artifact basename is unsafe'
staged_artifact="$transaction_root/$artifact_name"
staged_sidecar="$transaction_root/$artifact_name.sha256"
hybrid_pin_file "$api_artifact" "$staged_artifact" 0600 "${OPENBMB_EXPECTED_GID:-0}"
hybrid_pin_file "$api_sha256" "$staged_sidecar" 0600 "${OPENBMB_EXPECTED_GID:-0}"
hybrid_pin_file "$caddy_source" "$transaction_root/Caddyfile.hybrid" 0600 "${OPENBMB_EXPECTED_GID:-0}"
hybrid_pin_file "$caddy_file" "$transaction_root/Caddyfile.docker" 0600 "${OPENBMB_EXPECTED_GID:-0}"
hybrid_pin_file "$caddy_env" "$transaction_root/openbmb.env.docker" 0600 "${OPENBMB_EXPECTED_GID:-0}"
"$caddy_bin" validate --config "$transaction_root/Caddyfile.hybrid" \
  --adapter caddyfile --envfile "$transaction_root/openbmb.env.docker" >/dev/null || \
  fail 'the pinned hybrid Caddyfile does not validate against the active environment'

[[ "$(readlink -f -- "$current_app")" == "$releases_root/$expected_current_app" ]] || \
  fail 'current-app does not match the caller expectation'
[[ ! -e "$current_api" && ! -L "$current_api" ]] || \
  fail 'this one-time migration requires current-api to be absent'
[[ "$($upstream_helper current)" == 127.0.0.1:13100 ]] || \
  fail 'the Docker API is no longer the expected Caddy upstream'
[[ "$($docker_bin inspect --format '{{.State.Running}}' openbmb-api 2>/dev/null || true)" == true ]] || \
  fail 'the old Docker API is not running'
[[ "$($docker_bin inspect --format '{{.State.Health.Status}}' openbmb-api 2>/dev/null || true)" == healthy ]] || \
  fail 'the old Docker API is not healthy enough to serve as rollback'
"$curl_bin" --fail --silent --show-error --max-time 5 \
  http://127.0.0.1:13100/openBMB/api/v1/health/ready --output /dev/null || \
  fail 'the old Docker API readiness endpoint failed'
[[ "$($docker_bin inspect --format '{{.Config.Image}}' openbmb-api)" == \
   "openbmb-api:$expected_current_app" ]] || fail 'the Docker API image does not match current-app'
for web_container in openbmb-client-web openbmb-admin-web; do
  [[ "$($docker_bin inspect --format '{{.State.Running}}' "$web_container" 2>/dev/null || true)" == true ]] || \
    fail "$web_container must be running before migration"
done
web_status="$(/usr/local/sbin/openbmb-web-release status)"
grep -Eq '^current_release=web-[0-9a-f]{40}-[0-9a-f]{16}$' <<<"$web_status" || \
  fail 'a verified Web release must be promoted before migration'
"$systemctl_bin" is-enabled --quiet openbmb.service || \
  fail 'runtime-aware OpenBMB stack service is not enabled'
"$systemctl_bin" is-active --quiet openbmb.service || \
  fail 'runtime-aware OpenBMB stack service is not active'
[[ "$("$systemctl_bin" show --property=ExecStart --value openbmb.service)" == \
   *'/usr/local/sbin/openbmb-stack-control start'* ]] || \
  fail 'OpenBMB stack service is not using the runtime-aware start adapter'
[[ "$("$systemctl_bin" show --property=ExecStop --value openbmb.service)" == \
   *'/usr/local/sbin/openbmb-stack-control stop'* ]] || \
  fail 'OpenBMB stack service is not using the runtime-aware stop adapter'

case "$($runtime_mode status | sed -n 's/^mode=//p')" in
  uninitialized) "$runtime_mode" initialize-docker ;;
  docker) ;;
  *) fail 'runtime mode is not an unused Docker bootstrap state' ;;
esac

# The runtime adapter owns durable configuration snapshots and the fsynced
# transition journal. Replace only its hybrid target while mode is still Docker.
hybrid_pin_file "$transaction_root/Caddyfile.hybrid" \
  "$runtime_state/configs/hybrid/Caddyfile" 0600 "${OPENBMB_EXPECTED_GID:-0}"
hybrid_pin_file "$transaction_root/openbmb.env.docker" \
  "$runtime_state/configs/hybrid/openbmb.env" 0600 "${OPENBMB_EXPECTED_GID:-0}"
"$runtime_mode" begin-migration
transition_started=true

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$migration_complete" != true && "$transition_started" == true ]]; then
    printf 'HYBRID MIGRATION: rolling back the durable transition\n' >&2
    "$runtime_mode" recover || true
    "$native_deploy" recover || true
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# deploy validates and installs the artifact and starts the native candidate
# while Docker still serves 13100. Only its final helper call stops Docker and
# performs the Caddy cutover, keeping the unavoidable interruption very short.
OPENBMB_NATIVE_API_BOOTSTRAP_FROM_DOCKER=true \
OPENBMB_NATIVE_API_CADDY_HELPER="$cutover_helper" \
OPENBMB_RUNTIME_MODE_BIN="$runtime_mode" \
OPENBMB_API_UPSTREAM_HELPER="$upstream_helper" \
  "$native_deploy" deploy \
    --artifact "$staged_artifact" \
    --sha256 "$staged_sidecar" \
    --expected-current-app "$expected_current_app" \
    --expected-current-api none

OPENBMB_DOMAIN="$domain" "$hybrid_health" --local
OPENBMB_DOMAIN="$domain" "$hybrid_health" --public

# Images are retained as the explicit Docker fallback. Containers are removed
# only after native and public health pass; the runtime adapter can recreate
# them from current/current-app when switching back to Docker mode.
"$docker_bin" stop --time 15 openbmb-client-web openbmb-admin-web >/dev/null
"$docker_bin" rm openbmb-api openbmb-client-web openbmb-admin-web >/dev/null
OPENBMB_DOMAIN="$domain" "$hybrid_health" --local
OPENBMB_DOMAIN="$domain" "$hybrid_health" --public

"$runtime_mode" bootstrap-commit
printf 'complete\n' >"$transaction_root/migration.status.new"
chown "$hybrid_expected_uid:${OPENBMB_EXPECTED_GID:-0}" -- "$transaction_root/migration.status.new"
chmod 0600 -- "$transaction_root/migration.status.new"
hybrid_atomic_commit_file "$transaction_root/migration.status.new" "$transaction_root/migration.status"
migration_complete=true
transition_started=false
trap - EXIT HUP INT TERM
printf 'Hybrid migration completed; Docker rollback evidence: %s\n' "$transaction_root"
