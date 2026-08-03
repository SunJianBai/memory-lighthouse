#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

node_bin="${OPENBMB_NODE_BIN:-/opt/openbmb/runtime/node-v22.19.0-linux-x64/bin/node}"
libexec_dir="${OPENBMB_NATIVE_API_LIBEXEC:-/usr/local/libexec/openbmb-native-api}"
artifact_tool="${OPENBMB_NATIVE_API_ARTIFACT_TOOL:-$libexec_dir/artifact-tool.mjs}"
caddy_helper="${OPENBMB_NATIVE_API_CADDY_HELPER:-/usr/local/libexec/openbmb-switch-api-upstream}"
runtime_mode="${OPENBMB_RUNTIME_MODE_BIN:-/usr/local/sbin/openbmb-runtime-mode}"
state_root="${OPENBMB_STATE_ROOT:-/opt/openbmb}"
stack_releases_root="${OPENBMB_STACK_RELEASES_ROOT:-$state_root/releases}"
api_releases_root="${OPENBMB_NATIVE_API_RELEASES_ROOT:-$state_root/hybrid/api-releases}"
slots_root="${OPENBMB_NATIVE_API_SLOTS_ROOT:-$state_root/hybrid/api-slots}"
current_app="${OPENBMB_CURRENT_APP_LINK:-$state_root/current-app}"
current_api="${OPENBMB_CURRENT_API_LINK:-$state_root/current-api}"
previous_api="${OPENBMB_PREVIOUS_API_LINK:-$state_root/previous-api}"
security_pending="$state_root/security-boundary.pending"
minimum_epoch_file="$state_root/minimum-security-epoch"
deployment_pending="$state_root/hybrid/native-api.pending"
operation_lock="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"
infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
native_env="${OPENBMB_NATIVE_ENV_FILE:-/etc/openbmb/native-api.env}"
bootstrap_from_docker="${OPENBMB_NATIVE_API_BOOTSTRAP_FROM_DOCKER:-false}"
boot_recovery="${OPENBMB_NATIVE_API_BOOT_RECOVERY:-false}"
systemctl_bin="${OPENBMB_SYSTEMCTL_BIN:-/usr/bin/systemctl}"

temporary_root=''
incoming_root=''
candidate_slot=''
candidate_unit=''
old_upstream=''
target_upstream=''
old_slot='none'
old_current_api='none'
old_previous_api='none'
old_slot_target='none'
target_release=''
journal_written=false
committed=false
journal_phase=''
unsafe_path=''
declare -A gc_protected=()

log() { printf 'NATIVE API: %s\n' "$*"; }
fail() { printf 'NATIVE API: %s\n' "$*" >&2; exit 1; }
slow_path() { printf 'SLOW_PATH_REQUIRED: %s\n' "$*" >&2; exit 78; }

cleanup_temporary() {
  if [[ -n "$temporary_root" && -d "$temporary_root" ]]; then
    rm -rf -- "$temporary_root"
  fi
  if [[ -n "$incoming_root" && -d "$incoming_root" ]]; then
    rm -rf -- "$incoming_root"
  fi
}

is_release_id() { [[ "$1" =~ ^git-[0-9a-f]{12}$ ]]; }
is_upstream() { [[ "$1" =~ ^127\.0\.0\.1:(13100|13101|13102)$ ]]; }

assert_deploy_runtime_mode() {
  local observed_upstream="$1" expected_api="$2" status
  local -a mode_values=() upstream_values=() pending_values=()
  [[ -x "$runtime_mode" && ! -L "$runtime_mode" ]] || \
    fail 'hybrid runtime-mode adapter is unavailable'
  status="$($runtime_mode status)" || fail 'could not read the hybrid runtime mode'
  mapfile -t mode_values < <(sed -n 's/^mode=//p' <<<"$status")
  mapfile -t upstream_values < <(sed -n 's/^upstream=//p' <<<"$status")
  mapfile -t pending_values < <(sed -n 's/^pending=//p' <<<"$status")
  [[ "${#mode_values[@]}" -eq 1 && "${#upstream_values[@]}" -eq 1 && \
     "${#pending_values[@]}" -eq 1 ]] || fail 'runtime-mode status is ambiguous'
  [[ "${upstream_values[0]}" == "$observed_upstream" ]] || \
    fail 'runtime-mode and Caddy disagree about the active API upstream'
  case "$bootstrap_from_docker" in
    true)
      [[ "$expected_api" == none && "${mode_values[0]}" == docker && \
         "${pending_values[0]}" == yes && "$observed_upstream" == 127.0.0.1:13100 ]] || \
        fail 'Docker bootstrap requires the durable migration journal and the 13100 upstream'
      ;;
    false)
      [[ "$expected_api" != none && "${mode_values[0]}" == hybrid && \
         "${pending_values[0]}" == no && "$observed_upstream" =~ ^127\.0\.0\.1:1310[12]$ ]] || \
        fail 'ordinary native deployment requires a settled hybrid runtime mode'
      ;;
    *) fail 'OPENBMB_NATIVE_API_BOOTSTRAP_FROM_DOCKER must be true or false' ;;
  esac
}

expected_state_uid() {
  if [[ "$state_root" == /opt/openbmb ]]; then printf '0\n'; else id -u; fi
}

prepare_operation_lock() {
  local parent mode expected_uid
  [[ "$operation_lock" == /* && "$operation_lock" != / && "$operation_lock" != *$'\n'* ]] || \
    fail 'operation lock must be an absolute non-root path'
  parent="$(dirname -- "$operation_lock")"
  [[ -d "$parent" && ! -L "$parent" ]] || fail 'operation lock parent is unsafe'
  expected_uid="$(expected_state_uid)"
  [[ "$(stat -c %u -- "$parent")" == "$expected_uid" ]] || \
    fail 'operation lock parent has an unexpected owner'
  mode="$((8#$(stat -c %a -- "$parent")))"
  if (( (mode & 8#0022) != 0 && (mode & 8#1000) == 0 )); then
    fail 'writable operation lock parent must have the sticky bit'
  fi
  if [[ ! -e "$operation_lock" && ! -L "$operation_lock" ]]; then
    (umask 077; set -o noclobber; : >"$operation_lock") 2>/dev/null || true
  fi
  [[ -f "$operation_lock" && ! -L "$operation_lock" ]] || fail 'operation lock is unsafe'
  [[ "$(stat -c %u -- "$operation_lock")" == "$expected_uid" ]] || \
    fail 'operation lock has an unexpected owner'
  unsafe_path="$(find "$operation_lock" -maxdepth 0 -perm /0022 -print -quit)"
  [[ -z "$unsafe_path" ]] || fail 'operation lock is writable by group or other users'
}

assert_state_root() {
  local canonical expected_uid
  [[ "$state_root" == /* && "$state_root" != / && "$state_root" != *$'\n'* ]] || \
    fail 'state root must be an absolute non-root path without newlines'
  [[ -d "$state_root" && ! -L "$state_root" ]] || fail "invalid state root: $state_root"
  canonical="$(readlink -f -- "$state_root")"
  [[ "$canonical" == "$state_root" ]] || fail 'state root must be canonical and must not traverse links'
  expected_uid="$(expected_state_uid)"
  [[ "$(stat -c %u -- "$state_root")" == "$expected_uid" ]] || fail 'state root owner is invalid'
  unsafe_path="$(find "$state_root" -maxdepth 0 -perm /0022 -print -quit)"
  if [[ -n "$unsafe_path" ]]; then
    fail 'state root must not be writable by group or other users'
  fi
}

assert_managed_file() {
  local path="$1" expected_uid
  [[ -f "$path" && ! -L "$path" ]] || fail "managed file is not regular: $path"
  expected_uid="$(expected_state_uid)"
  [[ "$(stat -c %u -- "$path")" == "$expected_uid" ]] || fail "managed file owner is invalid: $path"
  unsafe_path="$(find "$path" -maxdepth 0 -perm /0022 -print -quit)"
  if [[ -n "$unsafe_path" ]]; then
    fail "managed file is writable by group or other users: $path"
  fi
}

resolve_direct_link() {
  local link="$1" root="$2" label="$3" canonical_root target
  [[ -L "$link" ]] || fail "$label must be a symbolic link: $link"
  canonical_root="$(readlink -f -- "$root")"
  target="$(readlink -f -- "$link")"
  [[ "$(dirname -- "$target")" == "$canonical_root" ]] || fail "$label escaped $canonical_root"
  is_release_id "$(basename -- "$target")" || fail "$label target has an invalid release ID"
  printf '%s\n' "$target"
}

read_epoch() {
  local path="$1" label="$2"
  local -a lines=()
  [[ -f "$path" && ! -L "$path" ]] || fail "$label security epoch is missing"
  mapfile -t lines <"$path"
  [[ "${#lines[@]}" -eq 1 && "${lines[0]}" =~ ^[1-9][0-9]*$ ]] || \
    fail "$label security epoch is invalid"
  ((10#${lines[0]} <= 2147483647)) || fail "$label security epoch exceeds the supported range"
  printf '%s\n' "${lines[0]}"
}

read_minimum_epoch() {
  local -a lines=()
  if [[ ! -e "$minimum_epoch_file" && ! -L "$minimum_epoch_file" ]]; then
    printf '0\n'
    return
  fi
  assert_managed_file "$minimum_epoch_file"
  mapfile -t lines <"$minimum_epoch_file"
  [[ "${#lines[@]}" -eq 1 && "${lines[0]}" =~ ^(0|[1-9][0-9]*)$ ]] || \
    fail 'minimum security epoch is invalid'
  printf '%s\n' "${lines[0]}"
}

atomic_link() {
  local target="$1" destination="$2" temporary
  temporary="${destination}.new.$$"
  ln -s -- "$target" "$temporary"
  mv -Tf -- "$temporary" "$destination"
  sync -f -- "$(dirname -- "$destination")"
}

durable_remove() {
  local destination="$1" parent
  if [[ ! -e "$destination" && ! -L "$destination" ]]; then return 0; fi
  [[ ! -d "$destination" || -L "$destination" ]] || fail "refusing durable file removal of a directory: $destination"
  parent="$(dirname -- "$destination")"
  rm -f -- "$destination"
  sync -f -- "$parent"
}

pin_root_input() {
  local source="$1" destination="$2" fd metadata owner mode inode linked_inode
  exec {fd}<"$source"
  [[ -f "/proc/$$/fd/$fd" ]] || fail "input descriptor is not a regular file: $source"
  metadata="$(stat -Lc '%u|%a|%d:%i' "/proc/$$/fd/$fd")"
  IFS='|' read -r owner mode inode <<<"$metadata"
  [[ "$owner" == 0 ]] || \
    fail "input changed or is not a root-owned regular file: $source"
  (( (8#$mode & 8#022) == 0 )) || fail "input is writable by group or other users: $source"

  # Prefer a zero-copy hard link, but prove it names the inode already opened
  # above. If the caller path changed or is on another filesystem, copy from
  # the stable descriptor rather than reopening the path.
  if ln -P -- "$source" "$destination" 2>/dev/null; then
    linked_inode="$(stat -Lc '%d:%i' "$destination")"
    if [[ "$linked_inode" != "$inode" ]]; then rm -f -- "$destination"; fi
  fi
  if [[ ! -e "$destination" && ! -L "$destination" ]]; then
    cp --reflink=auto -- "/proc/$$/fd/$fd" "$destination"
  fi
  exec {fd}<&-
  [[ -f "$destination" && ! -L "$destination" && "$(stat -c %u -- "$destination")" == 0 ]] || \
    fail 'pinned input failed its post-copy ownership/type check'
}

write_journal() {
  local phase="$1" temporary="${deployment_pending}.new.$$"
  mkdir -p -- "$(dirname -- "$deployment_pending")"
  {
    printf 'phase=%s\n' "$phase"
    printf 'candidate_slot=%s\n' "$candidate_slot"
    printf 'candidate_unit=%s\n' "$candidate_unit"
    printf 'old_upstream=%s\n' "$old_upstream"
    printf 'target_upstream=%s\n' "$target_upstream"
    printf 'old_slot=%s\n' "$old_slot"
    printf 'old_current_api=%s\n' "$old_current_api"
    printf 'old_previous_api=%s\n' "$old_previous_api"
    printf 'old_slot_target=%s\n' "$old_slot_target"
    printf 'target_release=%s\n' "$target_release"
  } >"$temporary"
  chmod 0600 -- "$temporary"
  if [[ "$state_root" == /opt/openbmb ]]; then chown root:root -- "$temporary"; fi
  sync -f -- "$temporary"
  mv -Tf -- "$temporary" "$deployment_pending"
  sync -f -- "$(dirname -- "$deployment_pending")"
  journal_written=true
}

load_journal() {
  local key value
  local -A seen=()
  local phase_value=''
  assert_managed_file "$deployment_pending"
  candidate_slot=''; candidate_unit=''; old_upstream=''; target_upstream=''
  old_slot=''; old_current_api=''; old_previous_api=''; old_slot_target=''; target_release=''
  while IFS='=' read -r key value; do
    [[ "$value" != *$'\n'* && -n "$value" ]] || fail 'pending journal contains an empty value'
    [[ -n "$key" ]] || fail 'pending journal contains an empty key'
    [[ -z "${seen[$key]:-}" ]] || fail "pending journal defines $key more than once"
    seen["$key"]=1
    case "$key" in
      phase) phase_value="$value" ;;
      candidate_slot) candidate_slot="$value" ;;
      candidate_unit) candidate_unit="$value" ;;
      old_upstream) old_upstream="$value" ;;
      target_upstream) target_upstream="$value" ;;
      old_slot) old_slot="$value" ;;
      old_current_api) old_current_api="$value" ;;
      old_previous_api) old_previous_api="$value" ;;
      old_slot_target) old_slot_target="$value" ;;
      target_release) target_release="$value" ;;
      *) fail "pending journal has an unknown key: $key" ;;
    esac
  done <"$deployment_pending"
  [[ "${#seen[@]}" -eq 10 ]] || fail 'pending journal is incomplete'
  [[ "$phase_value" =~ ^(prepared|candidate-ready|switched|committed)$ ]] || fail 'pending phase is invalid'
  [[ "$candidate_slot" =~ ^(blue|green)$ ]] || fail 'pending candidate slot is invalid'
  [[ "$candidate_unit" == "openbmb-native-api@${candidate_slot}.service" ]] || fail 'pending unit is invalid'
  is_upstream "$old_upstream" || fail 'pending old upstream is invalid'
  is_upstream "$target_upstream" || fail 'pending target upstream is invalid'
  [[ "$old_slot" =~ ^(none|blue|green)$ ]] || fail 'pending old slot is invalid'
  for value in "$old_current_api" "$old_previous_api" "$old_slot_target"; do
    if [[ "$value" != none ]]; then
      [[ "$(dirname -- "$value")" == "$(readlink -f -- "$api_releases_root")" ]] || \
        fail 'pending release target escaped the API release root'
      is_release_id "$(basename -- "$value")" || fail 'pending release target has an invalid ID'
    fi
  done
  [[ "$(dirname -- "$target_release")" == "$(readlink -f -- "$api_releases_root")" ]] || \
    fail 'pending target release escaped the API release root'
  is_release_id "$(basename -- "$target_release")" || fail 'pending target release has an invalid ID'
  journal_phase="$phase_value"
}

restore_link_or_absence() {
  local previous="$1" destination="$2"
  if [[ "$previous" == none ]]; then
    durable_remove "$destination"
  else
    [[ -d "$previous" && ! -L "$previous" && \
       "$(dirname -- "$previous")" == "$(readlink -f -- "$api_releases_root")" ]] || \
      fail "cannot restore unsafe release target: $previous"
    is_release_id "$(basename -- "$previous")" || fail "cannot restore invalid release ID: $previous"
    atomic_link "$previous" "$destination"
  fi
}

protect_release_path() {
  local path="$1"
  [[ "$path" == none ]] && return 0
  [[ "$(dirname -- "$path")" == "$(readlink -f -- "$api_releases_root")" ]] || \
    fail "refusing to protect an unsafe API release path: $path"
  is_release_id "$(basename -- "$path")" || fail "refusing to protect an invalid API release ID: $path"
  [[ -d "$path" && ! -L "$path" ]] || fail "protected API release is missing or unsafe: $path"
  gc_protected["$path"]=1
}

protect_release_link() {
  local link="$1" label="$2" target
  if [[ -L "$link" ]]; then
    target="$(resolve_direct_link "$link" "$api_releases_root" "$label")"
    protect_release_path "$target"
  elif [[ -e "$link" ]]; then
    fail "$label exists and is not a symlink: $link"
  fi
}

gc_releases() {
  local mode="$1" release expected_uid scratch
  local deleted_any=false
  [[ "$mode" == dry-run || "$mode" == execute ]] || fail 'GC mode must be dry-run or execute'
  gc_protected=()
  protect_release_link "$current_api" current-api
  protect_release_link "$previous_api" previous-api
  protect_release_link "$slots_root/blue" blue-slot
  protect_release_link "$slots_root/green" green-slot
  if [[ -e "$deployment_pending" || -L "$deployment_pending" ]]; then
    load_journal
    protect_release_path "$old_current_api"
    protect_release_path "$old_previous_api"
    protect_release_path "$old_slot_target"
    protect_release_path "$target_release"
  fi

  expected_uid="$(expected_state_uid)"
  while IFS= read -r -d '' release; do
    [[ "$(dirname -- "$release")" == "$(readlink -f -- "$api_releases_root")" ]] || \
      fail "GC candidate escaped the API release root: $release"
    [[ -d "$release" && ! -L "$release" ]] || fail "GC candidate is not a real directory: $release"
    is_release_id "$(basename -- "$release")" || fail "GC candidate has an invalid release ID: $release"
    unsafe_path="$(find "$release" \! -uid "$expected_uid" -print -quit)"
    [[ -z "$unsafe_path" ]] || fail "GC candidate has an unexpected owner: $release"
    unsafe_path="$(find "$release" -perm /0222 -print -quit)"
    [[ -z "$unsafe_path" ]] || fail "GC candidate is not mode-immutable: $release"
    if [[ -n "${gc_protected[$release]:-}" ]]; then
      printf 'retain %s\n' "$(basename -- "$release")"
      continue
    fi
    if [[ "$mode" == dry-run ]]; then
      printf 'would-delete %s\n' "$(basename -- "$release")"
    else
      rm -rf -- "$release"
      deleted_any=true
      printf 'deleted %s\n' "$(basename -- "$release")"
    fi
  done < <(find "$api_releases_root" -mindepth 1 -maxdepth 1 -name 'git-*' -print0)
  while IFS= read -r -d '' scratch; do
    [[ "$(dirname -- "$scratch")" == "$(readlink -f -- "$api_releases_root")" ]] || \
      fail "GC scratch candidate escaped the API release root: $scratch"
    [[ -d "$scratch" && ! -L "$scratch" ]] || fail "GC scratch candidate is not a real directory: $scratch"
    [[ "$(stat -c %u -- "$scratch")" == "$expected_uid" ]] || \
      fail "GC scratch candidate has an unexpected owner: $scratch"
    if [[ "$mode" == dry-run ]]; then
      printf 'would-delete-scratch %s\n' "$(basename -- "$scratch")"
    else
      rm -rf -- "$scratch"
      deleted_any=true
      printf 'deleted-scratch %s\n' "$(basename -- "$scratch")"
    fi
  done < <(
    find "$api_releases_root" -mindepth 1 -maxdepth 1 \
      \( -name '.incoming.*' -o -name '.staging.*' \) -print0
  )
  if [[ "$deleted_any" == true ]]; then sync -f -- "$api_releases_root"; fi
}

direct_health() {
  local upstream="$1" attempts="${OPENBMB_NATIVE_API_HEALTH_ATTEMPTS:-60}"
  local probe=''
  for _attempt in $(seq 1 "$attempts"); do
    if probe="$($node_bin -e '
      const base = process.argv[1];
      const paths = ["/openBMB/api/v1/health/live", "/openBMB/api/v1/health/ready"];
      Promise.all(paths.map(async (path) => {
        const response = await fetch(`http://${base}${path}`, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error(`${path}:${response.status}`);
      })).then(() => process.stdout.write("ok")).catch((error) => {
        console.error(error.message); process.exit(1);
      });
    ' "$upstream" 2>/dev/null)" && [[ "$probe" == ok ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

assert_native_unit_state() {
  local unit="$1" expected_active="$2" expected_unit_file="$3"
  local load_state active_state unit_file_state
  load_state="$("$systemctl_bin" show --property=LoadState --value "$unit")" || return 1
  active_state="$("$systemctl_bin" show --property=ActiveState --value "$unit")" || return 1
  unit_file_state="$("$systemctl_bin" show --property=UnitFileState --value "$unit")" || return 1
  [[ "$load_state" == loaded && "$active_state" == "$expected_active" && \
     "$unit_file_state" == "$expected_unit_file" ]]
}

quiesce_native_unit() {
  local unit="$1"
  "$systemctl_bin" disable --now "$unit" >/dev/null 2>&1 || return 1
  assert_native_unit_state "$unit" inactive disabled
}

activate_native_unit() {
  local unit="$1"
  "$systemctl_bin" enable --now "$unit" >/dev/null || return 1
  assert_native_unit_state "$unit" active enabled
}

enable_running_native_unit() {
  local unit="$1"
  "$systemctl_bin" enable "$unit" >/dev/null || return 1
  assert_native_unit_state "$unit" active enabled
}

rollback_failed_deploy() {
  local status=$? helper_current='' route_restored=false state_restored=true
  trap - EXIT HUP INT TERM
  set +e
  cleanup_temporary
  if [[ "$committed" == true ]]; then exit "$status"; fi
  if [[ "$journal_written" != true ]]; then
    gc_releases execute >/dev/null 2>&1 || \
      printf 'NATIVE API: warning: failed to collect an unreferenced release after deployment failure\n' >&2
    exit "$status"
  fi

  helper_current="$($caddy_helper current 2>/dev/null)"
  if [[ "$helper_current" == "$target_upstream" ]]; then
    if "$caddy_helper" switch --expected-upstream "$target_upstream" --target-upstream "$old_upstream"; then
      route_restored=true
    fi
  elif [[ "$helper_current" == "$old_upstream" ]]; then
    route_restored=true
  fi

  if [[ "$route_restored" == true ]]; then
    if quiesce_native_unit "$candidate_unit"; then
      restore_link_or_absence "$old_slot_target" "$slots_root/$candidate_slot" || state_restored=false
      restore_link_or_absence "$old_current_api" "$current_api" || state_restored=false
      restore_link_or_absence "$old_previous_api" "$previous_api" || state_restored=false
    else
      state_restored=false
      printf 'NATIVE API: candidate unit could not be proven inactive and disabled; retaining recovery evidence\n' >&2
    fi
    if [[ "$state_restored" == true ]] && durable_remove "$deployment_pending"; then
      gc_releases execute >/dev/null 2>&1 || \
        printf 'NATIVE API: warning: failed to collect an unreferenced release after rollback\n' >&2
      printf 'NATIVE API: failed deployment was restored to %s\n' "$old_upstream" >&2
    else
      printf 'NATIVE API: route was restored but pointer recovery is incomplete; retaining %s\n' \
        "$deployment_pending" >&2
    fi
  else
    printf 'NATIVE API: rollback could not prove the old Caddy route; candidate remains running and %s is retained\n' \
      "$deployment_pending" >&2
  fi
  exit "$status"
}

on_signal() { exit "$1"; }

install_release() {
  local extracted_payload="$1" release_id="$2" destination
  destination="$api_releases_root/$release_id"
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ -d "$destination" && ! -L "$destination" ]] || fail 'existing release path is not a real directory'
    "$node_bin" "$artifact_tool" verify-tree --root "$destination" >/dev/null
    cmp -s -- "$extracted_payload/manifest.json" "$destination/manifest.json" || \
      fail 'existing release ID belongs to a different full artifact'
    unsafe_path="$(find "$destination" \! -user root -print -quit)"
    [[ -z "$unsafe_path" ]] || fail 'existing release has a non-root-owned path'
    unsafe_path="$(find "$destination" -perm /0222 -print -quit)"
    if [[ -n "$unsafe_path" ]]; then
      fail 'existing release is not root-owned and mode-immutable'
    fi
    target_release="$destination"
    return
  fi
  incoming_root="$(mktemp -d -- "$api_releases_root/.incoming.XXXXXX")"
  chmod 0700 -- "$incoming_root"
  mv -- "$extracted_payload" "$incoming_root/$release_id"
  chown -R root:root -- "$incoming_root/$release_id"
  find "$incoming_root/$release_id" -type d -exec chmod 0555 -- {} +
  find "$incoming_root/$release_id" -type f -exec chmod 0444 -- {} +
  mv -- "$incoming_root/$release_id" "$destination"
  rmdir -- "$incoming_root"
  incoming_root=''
  sync -f -- "$api_releases_root"
  target_release="$destination"
}

deploy_command() {
  local artifact='' sha256='' expected_current_app='' expected_current_api=''
  local anchor_target anchor_id anchor_epoch floor_epoch active_migrations_digest
  local manifest release_id target_epoch target_migrations target_source helper_current active_slot_target
  local artifact_name staged_artifact staged_sidecar extraction_root anchor_source_sha
  while (($#)); do
    case "$1" in
      --artifact) artifact="${2:-}"; shift 2 ;;
      --sha256) sha256="${2:-}"; shift 2 ;;
      --expected-current-app) expected_current_app="${2:-}"; shift 2 ;;
      --expected-current-api) expected_current_api="${2:-}"; shift 2 ;;
      *) fail "unknown or incomplete deploy option: $1" ;;
    esac
  done
  [[ "$artifact" == /* && -f "$artifact" && ! -L "$artifact" ]] || \
    fail 'artifact must be an absolute regular non-symlink file'
  [[ "$sha256" == /* && -f "$sha256" && ! -L "$sha256" ]] || \
    fail 'SHA-256 sidecar must be an absolute regular non-symlink file'
  is_release_id "$expected_current_app" || fail 'expected current-app must be a git-* release ID'
  [[ "$expected_current_api" == none ]] || is_release_id "$expected_current_api" || \
    fail 'expected current-api must be a git-* release ID or none'
  [[ ! -e "$deployment_pending" && ! -L "$deployment_pending" ]] || \
    fail "an interrupted fast deployment exists; run recover first: $deployment_pending"
  [[ ! -e "$security_pending" && ! -L "$security_pending" ]] || \
    slow_path 'the durable security boundary is pending'

  anchor_target="$(resolve_direct_link "$current_app" "$stack_releases_root" current-app)"
  anchor_id="$(basename -- "$anchor_target")"
  [[ "$anchor_id" == "$expected_current_app" ]] || fail "current-app changed from the caller expectation"
  [[ "$(stat -c %u -- "$anchor_target")" == 0 ]] || fail 'current-app target must be root-owned'
  unsafe_path="$(find "$anchor_target" -maxdepth 0 -perm /0022 -print -quit)"
  if [[ -n "$unsafe_path" ]]; then
    fail 'current-app target must not be writable by group or other users'
  fi
  assert_managed_file "$anchor_target/.openbmb-release-sha"
  anchor_source_sha="$(tr -d '\r\n' <"$anchor_target/.openbmb-release-sha")"
  [[ "$anchor_source_sha" =~ ^[0-9a-f]{40}$ && "$anchor_id" == "git-${anchor_source_sha:0:12}" ]] || \
    fail 'current-app source attestation does not match its release ID'
  if [[ "$expected_current_api" == none ]]; then
    [[ ! -e "$current_api" && ! -L "$current_api" ]] || fail 'current-api appeared after caller inspection'
    old_current_api='none'
  else
    old_current_api="$(resolve_direct_link "$current_api" "$api_releases_root" current-api)"
    [[ "$(basename -- "$old_current_api")" == "$expected_current_api" ]] || \
      fail 'current-api changed from the caller expectation'
  fi
  if [[ -L "$previous_api" ]]; then
    old_previous_api="$(resolve_direct_link "$previous_api" "$api_releases_root" previous-api)"
  elif [[ -e "$previous_api" ]]; then
    fail 'previous-api exists and is not a symlink'
  else
    old_previous_api='none'
  fi

  helper_current="$($caddy_helper current)"
  is_upstream "$helper_current" || fail 'Caddy helper returned an invalid upstream'
  old_upstream="$helper_current"
  assert_deploy_runtime_mode "$old_upstream" "$expected_current_api"

  anchor_epoch="$(read_epoch "$anchor_target/infra/production/compatibility/security-epoch" current-app)"
  floor_epoch="$(read_minimum_epoch)"
  ((10#$anchor_epoch >= 10#$floor_epoch)) || fail 'current-app epoch is below the durable security floor'
  active_migrations_digest="$($node_bin "$artifact_tool" tree-digest \
    --root "$anchor_target/apps/server-api/prisma")"

  # Pin both caller paths into a root-only directory before validation. A hard
  # link avoids a second large on-disk copy when the upload and release roots
  # share a filesystem; reflink/copy is the safe fallback.
  temporary_root="$(mktemp -d -- "$api_releases_root/.staging.XXXXXX")"
  chmod 0700 -- "$temporary_root"
  artifact_name="$(basename -- "$artifact")"
  [[ "$artifact_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail 'artifact basename is unsafe'
  staged_artifact="$temporary_root/$artifact_name"
  staged_sidecar="$temporary_root/$artifact_name.sha256"
  pin_root_input "$artifact" "$staged_artifact"
  pin_root_input "$sha256" "$staged_sidecar"
  "$node_bin" "$artifact_tool" verify-archive \
    --archive "$staged_artifact" --sha256 "$staged_sidecar" >/dev/null
  extraction_root="$temporary_root/extracted"
  mkdir -m 0700 -- "$extraction_root"
  tar --extract --gzip --file "$staged_artifact" --directory "$extraction_root" \
    --no-same-owner --no-same-permissions --delay-directory-restore
  [[ -d "$extraction_root/payload" && ! -L "$extraction_root/payload" ]] || fail 'artifact has no payload directory'
  unsafe_path="$(find "$extraction_root/payload" \( -type l -o \( \! -type f -a \! -type d \) \) -print -quit)"
  if [[ -n "$unsafe_path" ]]; then
    fail 'extracted payload contains a link or special file'
  fi
  manifest="$extraction_root/payload/manifest.json"
  "$node_bin" "$artifact_tool" verify-tree --root "$extraction_root/payload" >/dev/null
  release_id="$($node_bin "$artifact_tool" manifest-field --manifest "$manifest" --field releaseId)"
  target_source="$($node_bin "$artifact_tool" manifest-field --manifest "$manifest" --field sourceSha)"
  target_epoch="$($node_bin "$artifact_tool" manifest-field --manifest "$manifest" --field securityEpoch)"
  target_migrations="$($node_bin "$artifact_tool" manifest-field --manifest "$manifest" --field migrationsDigest)"
  [[ "$release_id" == "git-${target_source:0:12}" ]] || fail 'artifact release identity is inconsistent'
  [[ "$target_epoch" == "$anchor_epoch" ]] || \
    slow_path "security epoch changed ($anchor_epoch -> $target_epoch)"
  [[ "$target_migrations" == "$active_migrations_digest" ]] || \
    slow_path 'Prisma migration set changed'
  ((10#$target_epoch >= 10#$floor_epoch)) || slow_path 'artifact epoch is below the durable floor'
  [[ "$expected_current_api" == none || "$release_id" != "$expected_current_api" ]] || \
    fail 'artifact is already the active native API release'

  install_release "$extraction_root/payload" "$release_id"
  rm -f -- "$staged_artifact" "$staged_sidecar"
  rmdir -- "$extraction_root" "$temporary_root"
  temporary_root=''

  case "$old_upstream" in
    127.0.0.1:13101) candidate_slot=green; target_upstream=127.0.0.1:13102; old_slot=blue ;;
    127.0.0.1:13102) candidate_slot=blue; target_upstream=127.0.0.1:13101; old_slot=green ;;
    127.0.0.1:13100) candidate_slot=blue; target_upstream=127.0.0.1:13101; old_slot=none ;;
  esac
  if [[ "$old_slot" != none && "$old_current_api" == none ]]; then
    fail 'Caddy points to a native slot but current-api is absent'
  fi
  if [[ "$old_slot" != none ]]; then
    active_slot_target="$(resolve_direct_link "$slots_root/$old_slot" "$api_releases_root" active-slot)"
    [[ "$active_slot_target" == "$old_current_api" ]] || \
      fail 'active native slot and current-api point to different releases'
  fi
  candidate_unit="openbmb-native-api@${candidate_slot}.service"
  assert_native_unit_state "$candidate_unit" inactive disabled || \
    fail 'candidate native API unit must be inactive and disabled before deployment'
  if [[ -L "$slots_root/$candidate_slot" ]]; then
    old_slot_target="$(resolve_direct_link "$slots_root/$candidate_slot" "$api_releases_root" candidate-slot)"
  elif [[ -e "$slots_root/$candidate_slot" ]]; then
    fail 'candidate slot path exists and is not a symlink'
  else
    old_slot_target='none'
  fi

  write_journal prepared
  atomic_link "$target_release" "$slots_root/$candidate_slot"
  # Keep the candidate out of the boot target until the route and durable
  # pointers are committed. A crash before commit therefore cannot boot two
  # API workers; the recovery service will either roll back or enable it.
  "$systemctl_bin" restart "$candidate_unit"
  assert_native_unit_state "$candidate_unit" active disabled || \
    fail 'candidate native API unit did not start in a disabled pre-commit state'
  direct_health "$target_upstream" || fail "candidate failed live/ready checks: $target_upstream"
  write_journal candidate-ready
  "$caddy_helper" switch --expected-upstream "$old_upstream" --target-upstream "$target_upstream"
  [[ "$($caddy_helper current)" == "$target_upstream" ]] || fail 'Caddy helper did not retain the target upstream'
  write_journal switched

  restore_link_or_absence "$old_current_api" "$previous_api"
  atomic_link "$target_release" "$current_api"
  write_journal committed
  committed=true
  enable_running_native_unit "$candidate_unit" || \
    fail 'committed candidate could not be proven active and enabled'
  if [[ "$old_slot" != none ]]; then
    quiesce_native_unit "openbmb-native-api@${old_slot}.service" || \
      fail 'old native API unit could not be proven inactive and disabled'
  fi
  durable_remove "$deployment_pending"
  journal_written=false
  gc_releases execute >/dev/null || \
    log 'warning: deployment committed but release GC did not complete; run gc --execute'
  log "release $release_id is active through $target_upstream; current-app remains anchored at $anchor_id"
}

recover_command() {
  local phase helper_current
  [[ -e "$deployment_pending" || -L "$deployment_pending" ]] || { log 'no native API recovery is pending'; return; }
  load_journal
  phase="$journal_phase"
  helper_current="$($caddy_helper current)"
  is_upstream "$helper_current" || fail 'Caddy helper returned an invalid upstream during recovery'
  if [[ "$phase" == committed ]]; then
    [[ "$helper_current" == "$target_upstream" ]] || \
      fail 'committed journal does not match the live Caddy upstream'
    restore_link_or_absence "$old_current_api" "$previous_api"
    atomic_link "$target_release" "$current_api"
    activate_native_unit "$candidate_unit" || \
      fail 'committed candidate could not be proven active and enabled during recovery'
    direct_health "$target_upstream" || fail 'committed candidate is not healthy during recovery'
    if [[ "$old_slot" != none ]]; then
      quiesce_native_unit "openbmb-native-api@${old_slot}.service" || \
        fail 'old native API unit could not be proven inactive and disabled during recovery'
    fi
    durable_remove "$deployment_pending"
    gc_releases execute >/dev/null || \
      log 'warning: committed recovery completed but release GC did not; run gc --execute'
    log "completed the committed deployment of $(basename -- "$target_release")"
    return
  fi
  if [[ "$helper_current" == "$target_upstream" ]]; then
    if [[ "$boot_recovery" == true ]]; then
      "$caddy_helper" stage --expected-upstream "$target_upstream" --target-upstream "$old_upstream"
    else
      "$caddy_helper" switch --expected-upstream "$target_upstream" --target-upstream "$old_upstream"
    fi
  elif [[ "$helper_current" != "$old_upstream" ]]; then
    fail 'Caddy points at neither side of the interrupted deployment; refusing automatic recovery'
  fi
  quiesce_native_unit "$candidate_unit" || \
    fail 'candidate native API unit could not be proven inactive and disabled during rollback'
  restore_link_or_absence "$old_slot_target" "$slots_root/$candidate_slot"
  restore_link_or_absence "$old_current_api" "$current_api"
  restore_link_or_absence "$old_previous_api" "$previous_api"
  durable_remove "$deployment_pending"
  gc_releases execute >/dev/null || \
    log 'warning: rollback recovery completed but release GC did not; run gc --execute'
  log "recovered the previous API route $old_upstream"
}

compatibility_command() {
  local anchor_target native_target anchor_epoch floor_epoch native_epoch
  local active_migrations_digest native_migrations manifest
  local infra_secret='' native_secret='' infra_secret_count=0 native_secret_count=0 line
  (($# == 0)) || fail 'compatibility takes no arguments'
  [[ ! -e "$security_pending" && ! -L "$security_pending" ]] || \
    slow_path 'the durable security boundary is pending'
  anchor_target="$(resolve_direct_link "$current_app" "$stack_releases_root" current-app)"
  native_target="$(resolve_direct_link "$current_api" "$api_releases_root" current-api)"
  assert_managed_file "$anchor_target/.openbmb-release-sha"
  manifest="$native_target/manifest.json"
  assert_managed_file "$manifest"
  "$node_bin" "$artifact_tool" verify-tree --root "$native_target" >/dev/null
  anchor_epoch="$(read_epoch "$anchor_target/infra/production/compatibility/security-epoch" current-app)"
  floor_epoch="$(read_minimum_epoch)"
  native_epoch="$($node_bin "$artifact_tool" manifest-field --manifest "$manifest" --field securityEpoch)"
  native_migrations="$($node_bin "$artifact_tool" manifest-field --manifest "$manifest" --field migrationsDigest)"
  active_migrations_digest="$($node_bin "$artifact_tool" tree-digest \
    --root "$anchor_target/apps/server-api/prisma")"
  [[ "$native_epoch" == "$anchor_epoch" ]] || \
    slow_path "native API security epoch differs from current-app ($native_epoch != $anchor_epoch)"
  ((10#$native_epoch >= 10#$floor_epoch)) || \
    slow_path 'native API security epoch is below the durable floor'
  [[ "$native_migrations" == "$active_migrations_digest" ]] || \
    slow_path 'native API Prisma migration set differs from current-app'
  assert_managed_file "$infra_env"
  assert_managed_file "$native_env"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == LIVEKIT_API_SECRET=* ]]; then
      infra_secret_count=$((infra_secret_count + 1))
      infra_secret="${line#LIVEKIT_API_SECRET=}"
    fi
  done <"$infra_env"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == LIVEKIT_API_SECRET=* ]]; then
      native_secret_count=$((native_secret_count + 1))
      native_secret="${line#LIVEKIT_API_SECRET=}"
    fi
  done <"$native_env"
  [[ "$infra_secret_count" -eq 1 && "$native_secret_count" -eq 1 && \
     "$infra_secret" =~ ^[A-Za-z0-9_-]{32,}$ && "$infra_secret" == "$native_secret" ]] || \
    slow_path 'native API LiveKit signing credential differs from infrastructure state'
  log "$(basename -- "$native_target") is compatible with $(basename -- "$anchor_target")"
}

status_command() {
  local app='none' api='none' previous='none' upstream
  if [[ -L "$current_app" ]]; then app="$(basename -- "$(readlink -f -- "$current_app")")"; fi
  if [[ -L "$current_api" ]]; then api="$(basename -- "$(readlink -f -- "$current_api")")"; fi
  if [[ -L "$previous_api" ]]; then previous="$(basename -- "$(readlink -f -- "$previous_api")")"; fi
  upstream="$($caddy_helper current)"
  printf 'current-app=%s\ncurrent-api=%s\nprevious-api=%s\nupstream=%s\npending=%s\n' \
    "$app" "$api" "$previous" "$upstream" \
    "$([[ -e "$deployment_pending" || -L "$deployment_pending" ]] && printf yes || printf no)"
}

gc_command() {
  local mode=dry-run
  if (($#)); then
    case "$1" in
      --dry-run) mode=dry-run ;;
      --execute) mode=execute ;;
      *) fail 'usage: openbmb-deploy-native-api gc [--dry-run|--execute]' ;;
    esac
    shift
  fi
  (($# == 0)) || fail 'usage: openbmb-deploy-native-api gc [--dry-run|--execute]'
  gc_releases "$mode"
}

main() {
  local command="${1:-}"
  [[ "$command" =~ ^(deploy|recover|compatibility|status|gc)$ ]] || \
    fail 'usage: openbmb-deploy-native-api deploy|recover|compatibility|status|gc [options]'
  shift
  [[ "$boot_recovery" =~ ^(true|false)$ ]] || \
    fail 'OPENBMB_NATIVE_API_BOOT_RECOVERY must be true or false'
  [[ "$boot_recovery" == false || "$command" == recover ]] || \
    fail 'boot recovery mode is valid only for recover'
  [[ "$(id -u)" == "$(expected_state_uid)" ]] || fail 'must run as the state owner (root in production)'
  [[ -x "$node_bin" && "$($node_bin --version)" == v22.19.0 ]] || fail 'fixed Node v22.19.0 runtime is unavailable'
  [[ -f "$artifact_tool" && ! -L "$artifact_tool" ]] || fail 'artifact tool is missing or unsafe'
  [[ -x "$caddy_helper" && ! -L "$caddy_helper" ]] || fail 'Caddy switch helper is missing or unsafe'
  [[ -x "$systemctl_bin" && ! -L "$systemctl_bin" ]] || fail 'systemctl is missing or unsafe'
  if [[ "$state_root" == /opt/openbmb ]]; then
    [[ "$(stat -c %u -- "$node_bin")" == 0 && "$(stat -c %u -- "$artifact_tool")" == 0 && \
       "$(stat -c %u -- "$caddy_helper")" == 0 && "$(stat -c %u -- "$systemctl_bin")" == 0 ]] || \
      fail 'runtime tools must be root-owned'
    unsafe_path="$(find "$node_bin" "$artifact_tool" "$caddy_helper" "$systemctl_bin" -maxdepth 0 -perm /0022 -print -quit)"
    if [[ -n "$unsafe_path" ]]; then
      fail 'runtime tools must not be writable by group or other users'
    fi
  fi
  command -v flock >/dev/null || fail 'flock is required'
  assert_state_root
  mkdir -p -- "$api_releases_root" "$slots_root"
  if [[ "$state_root" == /opt/openbmb ]]; then
    chown root:root -- "$api_releases_root" "$slots_root"
    chmod 0755 -- "$api_releases_root" "$slots_root"
  fi
  prepare_operation_lock
  case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
    false)
      exec 9<>"$operation_lock"
      if ! flock -n 9; then
        printf 'NATIVE API: another production operation owns %s\n' "$operation_lock" >&2
        exit 75
      fi
      export OPENBMB_OPERATION_LOCK_HELD=true
      export OPENBMB_OPERATION_LOCK="$operation_lock"
      export OPENBMB_OPERATION_LOCK_FD=9
      ;;
    true)
      inherited_fd="${OPENBMB_OPERATION_LOCK_FD:-}"
      [[ "$inherited_fd" =~ ^([3-9]|[1-9][0-9]+)$ && -e "/proc/$$/fd/$inherited_fd" ]] || \
        fail 'inherited operation-lock descriptor is missing'
      [[ "$(stat -Lc %d:%i -- "/proc/$$/fd/$inherited_fd")" == \
         "$(stat -Lc %d:%i -- "$operation_lock")" ]] || \
        fail 'inherited descriptor does not reference the production operation lock'
      flock -n "$inherited_fd" || fail 'inherited operation lock is not held'
      export OPENBMB_OPERATION_LOCK="$operation_lock"
      ;;
    *) fail 'OPENBMB_OPERATION_LOCK_HELD must be true or false' ;;
  esac
  trap cleanup_temporary EXIT
  trap 'on_signal 129' HUP
  trap 'on_signal 130' INT
  trap 'on_signal 143' TERM
  if [[ "$command" == deploy ]]; then trap rollback_failed_deploy EXIT; fi
  "${command}_command" "$@"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
