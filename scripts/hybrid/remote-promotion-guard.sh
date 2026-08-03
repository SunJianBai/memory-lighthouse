#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
umask 077

readonly operation_lock=/run/lock/openbmb-operation.lock
readonly runtime_mode=/usr/local/sbin/openbmb-runtime-mode
readonly upstream_helper=/usr/local/libexec/openbmb-switch-api-upstream
readonly api_deployer=/usr/local/sbin/openbmb-deploy-native-api
readonly web_deployer=/usr/local/sbin/openbmb-web-release

fail() {
  printf 'PROMOTION GUARD: %s\n' "$*" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || fail 'must run as root'
[[ "$#" -ge 1 ]] || fail 'missing component'
component="$1"

for command_name in awk basename chown chmod curl df dirname find flock grep id sha256sum stat; do
  command -v "$command_name" >/dev/null || fail "missing command: $command_name"
done
for trusted_binary in "$runtime_mode" "$upstream_helper" "$api_deployer" "$web_deployer"; do
  [[ -f "$trusted_binary" && ! -L "$trusted_binary" && -x "$trusted_binary" ]] || \
    fail "trusted runtime helper is unavailable: $trusted_binary"
  [[ "$(stat -c %u -- "$trusted_binary")" == 0 ]] || fail 'runtime helper is not root-owned'
  [[ -z "$(find "$trusted_binary" -maxdepth 0 -perm /0022 -print -quit)" ]] || \
    fail 'runtime helper is writable by group or other users'
done

lock_parent="$(dirname -- "$operation_lock")"
[[ -d "$lock_parent" && ! -L "$lock_parent" && "$(stat -c %u -- "$lock_parent")" == 0 ]] || \
  fail 'shared operation-lock parent is unsafe'
lock_parent_mode="$((8#$(stat -c %a -- "$lock_parent")))"
(( (lock_parent_mode & 8#0022) == 0 || (lock_parent_mode & 8#1000) != 0 )) || \
  fail 'writable operation-lock parent must have the sticky bit'
[[ -f "$operation_lock" && ! -L "$operation_lock" ]] || fail 'shared operation lock is unsafe'
[[ "$(stat -c %u -- "$operation_lock")" == 0 ]] || fail 'shared operation lock is not root-owned'
[[ -z "$(find "$operation_lock" -maxdepth 0 -perm /0022 -print -quit)" ]] || \
  fail 'shared operation lock is writable by group or other users'
exec 9<>"$operation_lock"
flock --exclusive --wait 120 --conflict-exit-code 75 9 || fail 'shared operation lock is busy'
export OPENBMB_OPERATION_LOCK="$operation_lock"
export OPENBMB_OPERATION_LOCK_HELD=true
export OPENBMB_OPERATION_LOCK_FD=9

assert_disk_capacity() {
  local path="$1" required="$2" available
  [[ "$required" =~ ^[1-9][0-9]*$ ]] || fail 'invalid disk requirement'
  available="$(df -P -B1 "$path" | awk 'NR == 2 { print $4 }')"
  [[ "$available" =~ ^[0-9]+$ ]] || fail 'could not determine available filesystem capacity'
  (( available >= required )) || \
    fail "insufficient disk before promotion: available=$available required=$required"
}

assert_incoming_directory() {
  local path="$1" expected_uid="$2"
  [[ -d "$path" && ! -L "$path" ]] || fail 'incoming directory is missing or linked'
  [[ "$(stat -c %u:%a -- "$path")" == "$expected_uid:700" ]] || \
    fail 'incoming directory has an unexpected owner or mode'
}

active_upstream=''
assert_hybrid_runtime() {
  local status helper_value
  local -a lines=()
  status="$($runtime_mode status)" || fail 'could not read runtime-mode status under the shared lock'
  mapfile -t lines <<<"$status"
  [[ "${#lines[@]}" -eq 3 ]] || fail 'runtime-mode status has an unexpected shape'
  [[ "${lines[0]}" == mode=hybrid ]] || fail 'runtime mode is not hybrid'
  [[ "${lines[1]}" =~ ^upstream=(127\.0\.0\.1:1310[12])$ ]] || \
    fail 'hybrid runtime is not routed to a native API slot'
  active_upstream="${BASH_REMATCH[1]}"
  [[ "${lines[2]}" == pending=no ]] || fail 'a runtime transition is pending'
  helper_value="$($upstream_helper current)" || fail 'could not read the authoritative Caddy upstream'
  [[ "$helper_value" == "$active_upstream" ]] || fail 'runtime-mode and Caddy upstream disagree'
  curl --fail --silent --show-error --max-time 10 \
    "http://$active_upstream/openBMB/api/v1/health/ready" --output /dev/null || \
    fail 'the active native API slot is not ready'
}

case "$component" in
  upload-preflight)
    [[ "$#" -eq 3 ]] || \
      fail 'usage: remote-promotion-guard.sh upload-preflight api|web REQUIRED_BYTES'
    target_component="$2"
    required_bytes="$3"
    assert_hybrid_runtime
    case "$target_component" in
      api)
        [[ -f "$api_deployer" && ! -L "$api_deployer" && -x "$api_deployer" ]] || \
          fail 'API deployer is unavailable'
        "$api_deployer" gc --execute
        ;;
      web)
        [[ -f "$web_deployer" && ! -L "$web_deployer" && -x "$web_deployer" ]] || \
          fail 'Web deployer is unavailable'
        "$web_deployer" status >/dev/null
        ;;
      *) fail 'upload preflight component must be api or web' ;;
    esac
    assert_disk_capacity /opt/openbmb "$required_bytes"
    printf 'Upload preflight completed for %s.\n' "$target_component"
    ;;
  web)
    [[ "$#" -eq 5 ]] || fail 'usage: remote-promotion-guard.sh web SHA ARCHIVE SHA256 REQUIRED_BYTES'
    source_sha="${2,,}"
    archive="$3"
    archive_sha256="${4,,}"
    required_bytes="$5"
    [[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || \
      fail 'invalid Web artifact identity'
    [[ "$(dirname -- "$archive")" == /home/ubuntu/.openbmb-web-incoming ]] || \
      fail 'Web artifact is outside the managed incoming root'
    [[ "$(basename -- "$archive")" =~ ^openbmb-web-$source_sha-$archive_sha256-([0-9]+-[0-9]+|[0-9a-f]{32})\.tar\.zst$ ]] || \
      fail 'Web artifact name does not bind the source and digest'
    [[ -f "$archive" && ! -L "$archive" ]] || fail 'Web artifact is missing or linked'
    deployment_uid="$(id -u ubuntu)"
    assert_incoming_directory "$(dirname -- "$archive")" "$deployment_uid"
    [[ "$(stat -c %u -- "$archive")" == "$deployment_uid" ]] || \
      fail 'Web artifact must be owned by ubuntu'
    chmod 0600 -- "$archive"
    [[ "$(sha256sum "$archive" | awk '{ print $1 }')" == "$archive_sha256" ]] || \
      fail 'Web artifact digest changed after upload'
    [[ -f "$web_deployer" && ! -L "$web_deployer" && -x "$web_deployer" ]] || \
      fail 'Web deployer is unavailable'
    assert_disk_capacity "$(dirname -- "$archive")" "$required_bytes"
    assert_hybrid_runtime
    "$web_deployer" promote "$source_sha" "$archive" "$archive_sha256"
    ;;
  api)
    [[ "$#" -eq 7 ]] || fail 'usage: remote-promotion-guard.sh api SHA ARCHIVE SIDECAR SHA256 RELEASE REQUIRED_BYTES'
    source_sha="${2,,}"
    archive="$3"
    sidecar="$4"
    archive_sha256="${5,,}"
    release_id="$6"
    required_bytes="$7"
    [[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || \
      fail 'invalid API artifact identity'
    [[ "$release_id" == "git-${source_sha:0:12}" ]] || fail 'API release does not match the source SHA'
    directory="$(dirname -- "$archive")"
    [[ "$(dirname -- "$directory")" == /home/ubuntu/.openbmb-api-incoming ]] || \
      fail 'API artifact is outside the managed incoming root'
    [[ "$(basename -- "$directory")" =~ ^$source_sha-[0-9]+-[0-9]+$ ]] || \
      fail 'API incoming directory does not bind the source SHA'
    [[ "$(basename -- "$archive")" == "openbmb-native-api-$release_id.tar.gz" ]] || \
      fail 'API artifact name does not match the release'
    [[ "$sidecar" == "$archive.sha256" ]] || fail 'API sidecar path is not canonical'
    deployment_uid="$(id -u ubuntu)"
    assert_incoming_directory "$(dirname -- "$directory")" "$deployment_uid"
    assert_incoming_directory "$directory" "$deployment_uid"
    for artifact_path in "$archive" "$sidecar"; do
      [[ -f "$artifact_path" && ! -L "$artifact_path" ]] || fail 'API artifact evidence is missing or linked'
      [[ "$(stat -c %u -- "$artifact_path")" == "$deployment_uid" ]] || \
        fail 'API artifact evidence must arrive owned by ubuntu'
    done
    chmod 0600 -- "$archive" "$sidecar"
    chown root:root -- "$archive" "$sidecar"
    [[ "$(sha256sum "$archive" | awk '{ print $1 }')" == "$archive_sha256" ]] || \
      fail 'API artifact digest changed after upload'
    grep -Fxq "$archive_sha256  $(basename -- "$archive")" "$sidecar" || \
      fail 'API sidecar does not bind the exact archive'
    [[ -f "$api_deployer" && ! -L "$api_deployer" && -x "$api_deployer" ]] || \
      fail 'API deployer is unavailable'
    assert_disk_capacity "$directory" "$required_bytes"
    assert_hybrid_runtime

    api_status="$($api_deployer status)" || fail 'could not read native API status under the shared lock'
    mapfile -t api_lines <<<"$api_status"
    [[ "${#api_lines[@]}" -eq 5 ]] || fail 'native API status has an unexpected shape'
    [[ "${api_lines[0]}" =~ ^current-app=(git-[0-9a-f]{12})$ ]] || \
      fail 'native API status has an invalid current-app pointer'
    current_app="${BASH_REMATCH[1]}"
    [[ "${api_lines[1]}" =~ ^current-api=(git-[0-9a-f]{12})$ ]] || \
      fail 'hybrid mode requires an active native API pointer'
    current_api="${BASH_REMATCH[1]}"
    [[ "${api_lines[2]}" =~ ^previous-api=(none|git-[0-9a-f]{12})$ ]] || \
      fail 'native API status has an invalid previous pointer'
    [[ "${api_lines[3]}" == "upstream=$active_upstream" ]] || fail 'native API and runtime upstream disagree'
    [[ "${api_lines[4]}" == pending=no ]] || fail 'a native API deployment is pending'

    if [[ "$current_api" == "$release_id" ]]; then
      curl --fail --silent --show-error --max-time 10 \
        "http://$active_upstream/openBMB/api/v1/health/ready" --output /dev/null || \
        fail 'same-release native API slot is not ready'
      printf 'Native API release %s is already active through %s.\n' \
        "$release_id" "$active_upstream"
      exit 0
    fi

    "$api_deployer" deploy \
      --artifact "$archive" \
      --sha256 "$sidecar" \
      --expected-current-app "$current_app" \
      --expected-current-api "$current_api"
    ;;
  *) fail 'component must be api or web' ;;
esac
