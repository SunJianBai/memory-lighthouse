#!/usr/bin/env bash
set -Eeuo pipefail

case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
    active_entry="$current_link/infra/production/scripts/clamav-watchdog.sh"
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$active_entry" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

[[ "$#" -eq 0 ]] || {
  printf 'usage: %s\n' "${BASH_SOURCE[0]}" >&2
  exit 2
}

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
script_dir="$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd -P)"
infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
[[ -f "$infra_env" ]] || {
  printf 'ClamAV watchdog environment is missing: %s\n' "$infra_env" >&2
  exit 1
}
clamav_port="$(
  awk -F= '$1 == "CLAMAV_HOST_PORT" { sub(/^[^=]*=/, ""); print; exit }' \
    "$infra_env"
)"
[[ "$clamav_port" =~ ^[0-9]+$ && "$clamav_port" -ge 1 && \
   "$clamav_port" -le 65535 ]] || {
  printf 'CLAMAV_HOST_PORT must be between 1 and 65535\n' >&2
  exit 1
}
max_signature_age_seconds=259200 # 72 hours; FreshClam checks twice daily.
minimum_recovery_interval_seconds=3600
case "${OPENBMB_WATCHDOG_SELF_TEST:-false}" in
  false)
    [[ -z "${OPENBMB_WATCHDOG_TEST_STATE_DIR:-}" && \
       -z "${OPENBMB_WATCHDOG_TEST_GRACE_SECONDS:-}" && \
       -z "${OPENBMB_WATCHDOG_TEST_AUXILIARY_SECONDS:-}" ]] || {
      printf 'Watchdog test overrides are forbidden in production mode\n' >&2
      exit 1
    }
    watchdog_state_dir=/run/openbmb
    expected_state_owner=0
    attestation_grace_seconds=180
    auxiliary_wait_seconds=900
    ;;
  true)
    watchdog_state_dir="${OPENBMB_WATCHDOG_TEST_STATE_DIR:-}"
    case "$watchdog_state_dir" in
      /tmp/openbmb-watchdog-test.[A-Za-z0-9]*) ;;
      *) printf 'The watchdog self-test state must use /tmp/openbmb-watchdog-test.*\n' >&2; exit 1 ;;
    esac
    expected_state_owner="$(id -u)"
    attestation_grace_seconds="${OPENBMB_WATCHDOG_TEST_GRACE_SECONDS:-1}"
    auxiliary_wait_seconds="${OPENBMB_WATCHDOG_TEST_AUXILIARY_SECONDS:-1}"
    [[ "$attestation_grace_seconds" =~ ^[0-9]+$ && \
       "$attestation_grace_seconds" -ge 1 && \
       "$attestation_grace_seconds" -le 180 ]] || exit 1
    [[ "$auxiliary_wait_seconds" =~ ^[0-9]+$ && \
       "$auxiliary_wait_seconds" -ge 1 && \
       "$auxiliary_wait_seconds" -le 900 ]] || exit 1
    ;;
  *) printf 'OPENBMB_WATCHDOG_SELF_TEST must be true or false\n' >&2; exit 1 ;;
esac
[[ ! -L "$watchdog_state_dir" ]] || {
  printf 'ClamAV watchdog state directory must not be a symbolic link\n' >&2
  exit 1
}
if [[ ! -e "$watchdog_state_dir" ]]; then
  mkdir -- "$watchdog_state_dir"
fi
[[ -d "$watchdog_state_dir" && ! -L "$watchdog_state_dir" ]] || {
  printf 'ClamAV watchdog state path must be a real directory\n' >&2
  exit 1
}
[[ "$(readlink -f -- "$watchdog_state_dir")" == "$watchdog_state_dir" ]] || {
  printf 'ClamAV watchdog state directory must not traverse symbolic links\n' >&2
  exit 1
}
[[ "$(stat -c %u -- "$watchdog_state_dir")" == "$expected_state_owner" ]] || {
  printf 'ClamAV watchdog state directory has an unexpected owner\n' >&2
  exit 1
}
chmod 0700 -- "$watchdog_state_dir"
[[ "$(stat -c %a -- "$watchdog_state_dir")" == 700 ]] || {
  printf 'ClamAV watchdog state directory must use mode 0700\n' >&2
  exit 1
}
recovery_stamp="$watchdog_state_dir/clamav-last-recovery"

assert_managed_container_if_present() {
  local compose_project
  local compose_service

  docker container inspect openbmb-clamav >/dev/null 2>&1 || return 0
  compose_project="$(
    docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' \
      openbmb-clamav
  )"
  compose_service="$(
    docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' \
      openbmb-clamav
  )"
  if [[ "$compose_project" != openbmb || "$compose_service" != clamav ]]; then
    printf 'UNHEALTHY: openbmb-clamav is not the managed OpenBMB scanner; stopping it\n' >&2
    docker stop --time 90 openbmb-clamav >/dev/null 2>&1 || true
    return 1
  fi
}

assert_managed_container_if_present || exit 1

container_health() {
  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    openbmb-clamav 2>/dev/null || true
}

freshclam_is_running() {
  docker exec openbmb-clamav sh -c '
    for process_name in /proc/[0-9]*/comm; do
      IFS= read -r name <"$process_name" || continue
      [ "$name" = freshclam ] && exit 0
    done
    exit 1
  ' >/dev/null 2>&1
}

disk_signature_state() {
  docker exec openbmb-clamav sh -c '
    database=
    [ ! -f /var/lib/clamav/daily.cvd ] || database=/var/lib/clamav/daily.cvd
    [ ! -f /var/lib/clamav/daily.cld ] || database=/var/lib/clamav/daily.cld
    [ -n "$database" ] || exit 1
    version="$(
      sigtool --info "$database" |
        awk -F: "/^[[:space:]]*Version:/ { gsub(/[[:space:]]/, \"\", \$2); print \$2; exit }"
    )" || exit 1
    modified="$(stat -c %Y "$database")" || exit 1
    case "$version:$modified" in
      *[!0-9:]*|:*|*:) exit 1 ;;
    esac
    printf "%s %s\n" "$version" "$modified"
  ' 2>/dev/null
}

loaded_signature_state() {
  local version_reply
  local engine_version
  local database_version
  local database_date
  local database_epoch

  version_reply="$(
    timeout 5 bash -c '
      set -e
      exec 3<>"/dev/tcp/$1/$2"
      printf "zVERSION\0" >&3
      IFS= read -r -d "" response <&3
      printf "%s" "$response"
    ' bash 127.0.0.1 "$clamav_port"
  )" || return 1
  IFS=/ read -r engine_version database_version database_date <<<"$version_reply"
  [[ "$engine_version" == ClamAV\ * && "$database_version" =~ ^[0-9]+$ && \
     -n "$database_date" ]] || return 1
  database_epoch="$(LC_ALL=C date --date="$database_date" +%s 2>/dev/null)" || return 1
  [[ "$database_epoch" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s\n' "$database_version" "$database_epoch"
}

signatures_are_fresh() {
  local disk_version
  local disk_epoch
  local loaded_version
  local loaded_epoch
  local now_epoch
  local signature_epoch
  local age_seconds

  read -r disk_version disk_epoch < <(disk_signature_state) || return 1
  read -r loaded_version loaded_epoch < <(loaded_signature_state) || return 1
  [[ "$disk_version" == "$loaded_version" ]] || return 1
  now_epoch="$(date +%s)"
  for signature_epoch in "$disk_epoch" "$loaded_epoch"; do
    age_seconds=$((now_epoch - signature_epoch))
    (( age_seconds >= 0 && age_seconds <= max_signature_age_seconds )) || return 1
  done
}

auxiliary_health_is_ready() {
  freshclam_is_running && signatures_are_fresh
}

wait_for_auxiliary_health() {
  local deadline=$((SECONDS + auxiliary_wait_seconds))
  local remaining_seconds

  while (( SECONDS < deadline )); do
    auxiliary_health_is_ready && return 0
    remaining_seconds=$((deadline - SECONDS))
    (( remaining_seconds > 10 )) && remaining_seconds=10
    sleep "$remaining_seconds"
  done
  return 1
}

wait_for_complete_attestation() {
  local deadline=$((SECONDS + attestation_grace_seconds))
  local remaining_seconds

  # ConcurrentDatabaseReload=no briefly pauses scans during the normal daily
  # database replacement. Give that expected window three minutes before
  # classifying a healthy container as broken.
  while (( SECONDS < deadline )); do
    if bash "$script_dir/verify-clamav.sh" --once && \
       auxiliary_health_is_ready; then
      return 0
    fi
    remaining_seconds=$((deadline - SECONDS))
    (( remaining_seconds > 10 )) && remaining_seconds=10
    sleep "$remaining_seconds"
  done
  return 1
}

stop_unattested_scanner() {
  if ! bash "$script_dir/compose.sh" stop --timeout 90 clamav; then
    docker stop --time 90 openbmb-clamav >/dev/null 2>&1 || true
  fi
}

stop_on_signal() {
  local status="$1"
  trap - HUP INT TERM
  printf 'UNHEALTHY: watchdog interrupted; stopping unattested scans\n' >&2
  stop_unattested_scanner
  exit "$status"
}
trap 'stop_on_signal 129' HUP
trap 'stop_on_signal 130' INT
trap 'stop_on_signal 143' TERM

recovery_is_rate_limited() {
  local last_recovery
  local now_epoch="$1"

  [[ -f "$recovery_stamp" ]] || return 1
  last_recovery="$(<"$recovery_stamp")"
  [[ "$last_recovery" =~ ^[0-9]+$ ]] || return 1
  (( now_epoch - last_recovery >= 0 && \
     now_epoch - last_recovery < minimum_recovery_interval_seconds ))
}

initial_health="$(container_health)"
if [[ "$initial_health" == starting ]]; then
  # A new empty signature volume may legitimately need most of the 30-minute
  # ClamAV startup allowance. Do not restart it while FreshClam is bootstrapping.
  if bash "$script_dir/verify-clamav.sh" --wait && \
     wait_for_auxiliary_health; then
    printf 'HEALTHY: ClamAV engine, FreshClam daemon and daily signatures are ready\n'
    exit 0
  fi
  # Do not begin another full 30-minute startup cycle in one watchdog run.
  # The timer will retry and restart only after Docker marks the service
  # unhealthy, keeping the systemd timeout and restart rate bounded.
  printf 'UNHEALTHY: ClamAV did not complete its initial engine/signature startup\n' >&2
  stop_unattested_scanner
  exit 1
elif [[ "$initial_health" == healthy ]] && wait_for_complete_attestation; then
  printf 'HEALTHY: ClamAV engine, FreshClam daemon and daily signatures are ready\n'
  exit 0
fi

now_epoch="$(date +%s)"
if recovery_is_rate_limited "$now_epoch"; then
  printf 'UNHEALTHY: ClamAV recovery is cooling down; keeping unattested scans unavailable\n' >&2
  stop_unattested_scanner
  exit 1
fi
printf '%s\n' "$now_epoch" >"$recovery_stamp"
chmod 0600 -- "$recovery_stamp"

printf 'RECOVERY: reconciling the release-scoped ClamAV service (%s)\n' \
  "${initial_health:-missing}" >&2
if ! bash "$script_dir/compose.sh" up -d --pull never --no-build \
  --force-recreate clamav; then
  printf 'UNHEALTHY: ClamAV reconciliation failed; stopping unattested scans\n' >&2
  stop_unattested_scanner
  exit 1
fi

if ! bash "$script_dir/verify-clamav.sh" --wait || \
   ! wait_for_auxiliary_health; then
  printf 'UNHEALTHY: FreshClam is absent or daily signatures exceed 72 hours\n' >&2
  stop_unattested_scanner
  exit 1
fi
printf 'RECOVERED: ClamAV engine, FreshClam daemon and daily signatures are ready\n'
