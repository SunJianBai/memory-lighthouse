#!/usr/bin/env bash
set -Eeuo pipefail

# Git for Windows otherwise emulates `ln -s` by copying directories, which is
# deliberately rejected by the production pointer validator.
case "$(uname -s)" in
  MINGW*|MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict" ;;
esac

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
fixture=''
state_fixture=''

cleanup() {
  if [[ -n "$fixture" && -d "$fixture" ]]; then rm -rf -- "$fixture"; fi
  if [[ -n "$state_fixture" && -d "$state_fixture" ]]; then rm -rf -- "$state_fixture"; fi
}
trap cleanup EXIT

node --check "$script_dir/runtime-lib.mjs"
node --check "$script_dir/artifact-tool.mjs"
node --check "$script_dir/launcher.mjs"
node --check "$script_dir/render-native-env.mjs"
bash -n "$script_dir/deploy-native-api.sh"
bash -n "$script_dir/export-current-container.sh"
bash -n "$script_dir/install-native-api.sh"
grep -Fq 'set -o noclobber' "$script_dir/export-current-container.sh"
grep -Fq 'exec 9<>"$operation_lock"' "$script_dir/export-current-container.sh"
! grep -Fq 'exec 9>"$operation_lock"' "$script_dir/export-current-container.sh"
grep -Fq 'set -o noclobber' "$script_dir/deploy-native-api.sh"
grep -Fq 'exec 9<>"$operation_lock"' "$script_dir/deploy-native-api.sh"
! grep -Fq 'exec 9>"$operation_lock"' "$script_dir/deploy-native-api.sh"
grep -Fq 'assert_deploy_runtime_mode "$old_upstream" "$expected_current_api"' \
  "$script_dir/deploy-native-api.sh"
grep -Fq "fail 'ordinary native deployment requires a settled hybrid runtime mode'" \
  "$script_dir/deploy-native-api.sh"
grep -Fq '"$caddy_helper" stage --expected-upstream' "$script_dir/deploy-native-api.sh"
grep -Fq 'OPENBMB_NATIVE_API_BOOT_RECOVERY must be true or false' \
  "$script_dir/deploy-native-api.sh"
grep -Fq 'compatibility_command()' "$script_dir/deploy-native-api.sh"
grep -Fq "slow_path 'native API LiveKit signing credential differs from infrastructure state'" \
  "$script_dir/deploy-native-api.sh"
restart_line="$(grep -nF -m 1 '"$systemctl_bin" restart "$candidate_unit"' \
  "$script_dir/deploy-native-api.sh" | cut -d: -f1)"
enable_line="$(grep -nF -m 1 'enable_running_native_unit "$candidate_unit"' \
  "$script_dir/deploy-native-api.sh" | cut -d: -f1)"
[[ -n "$restart_line" && -n "$enable_line" && "$restart_line" -lt "$enable_line" ]]
grep -Fq 'assert_native_unit_state "$candidate_unit" active disabled' \
  "$script_dir/deploy-native-api.sh"
grep -Fq 'quiesce_native_unit "openbmb-native-api@${old_slot}.service"' \
  "$script_dir/deploy-native-api.sh"
if grep -En 'systemctl[^\n]*(stop|disable)[^\n]*\|\| true' \
  "$script_dir/deploy-native-api.sh" >/dev/null 2>&1; then
  printf 'native API deploy still suppresses a unit quiescence failure\n' >&2
  exit 1
fi

# Production starts with root:openbmb 0640 source files. The strict renderer
# must only run after the installer has removed group access.
tighten_line="$(grep -nF -m 1 'chmod 0600 -- /etc/openbmb/infra.env /etc/openbmb/api.env' \
  "$script_dir/install-native-api.sh" | cut -d: -f1)"
render_line="$(grep -nF -m 1 '"$node_bin" "$libexec_dir/render-native-env.mjs"' \
  "$script_dir/install-native-api.sh" | cut -d: -f1)"
[[ -n "$tighten_line" && -n "$render_line" && "$tighten_line" -lt "$render_line" ]]

node --test "$script_dir/test/runtime.test.mjs"

# Exercise durable journal/pointer writes and safe release GC against a real
# filesystem. Sourcing is intentional: the production script's guarded main
# entry point leaves these narrow state-machine interfaces independently
# testable without systemd or Caddy.
state_fixture="$(mktemp -d)"
(
  export OPENBMB_STATE_ROOT="$state_fixture/state"
  export OPENBMB_NATIVE_API_RELEASES_ROOT="$state_fixture/state/hybrid/api-releases"
  export OPENBMB_NATIVE_API_SLOTS_ROOT="$state_fixture/state/hybrid/api-slots"
  export OPENBMB_CURRENT_API_LINK="$state_fixture/state/current-api"
  export OPENBMB_PREVIOUS_API_LINK="$state_fixture/state/previous-api"
  # shellcheck source=../deploy-native-api.sh
  source "$script_dir/deploy-native-api.sh"

  unit_fixture="$state_fixture/unit-state"
  unit_mock="$state_fixture/systemctl"
  mkdir -- "$unit_fixture"
  cat >"$unit_mock" <<'MOCK'
#!/usr/bin/env bash
unit="${@: -1}"
key="${unit//[^A-Za-z0-9]/_}"
case "$1" in
  show)
    case "$2" in
      --property=LoadState) printf 'loaded\n' ;;
      --property=ActiveState)
        [[ -f "$UNIT_FIXTURE/$key.active" ]] && printf 'active\n' || printf 'inactive\n'
        ;;
      --property=UnitFileState)
        [[ -f "$UNIT_FIXTURE/$key.enabled" ]] && printf 'enabled\n' || printf 'disabled\n'
        ;;
      *) exit 2 ;;
    esac
    ;;
  restart) touch "$UNIT_FIXTURE/$key.active" ;;
  enable)
    touch "$UNIT_FIXTURE/$key.enabled"
    [[ "${2:-}" != --now ]] || touch "$UNIT_FIXTURE/$key.active"
    ;;
  disable)
    [[ "${2:-}" == --now ]] || exit 2
    [[ ! -f "$UNIT_FIXTURE/$key.fail-disable" ]] || exit 1
    rm -f "$UNIT_FIXTURE/$key.active" "$UNIT_FIXTURE/$key.enabled"
    ;;
  *) exit 2 ;;
esac
MOCK
  chmod 0700 -- "$unit_mock"
  export UNIT_FIXTURE="$unit_fixture"
  systemctl_bin="$unit_mock"
  fixture_unit='openbmb-native-api@blue.service'
  fixture_key='openbmb_native_api_blue_service'
  touch "$unit_fixture/$fixture_key.active"
  enable_running_native_unit "$fixture_unit"
  assert_native_unit_state "$fixture_unit" active enabled
  quiesce_native_unit "$fixture_unit"
  assert_native_unit_state "$fixture_unit" inactive disabled
  touch "$unit_fixture/$fixture_key.active" "$unit_fixture/$fixture_key.enabled" \
    "$unit_fixture/$fixture_key.fail-disable"
  if quiesce_native_unit "$fixture_unit"; then
    printf 'unit quiescence accepted a failed disable --now\n' >&2
    exit 1
  fi
  assert_native_unit_state "$fixture_unit" active enabled

  mkdir -p -- "$api_releases_root" "$slots_root"
  current_release="$api_releases_root/git-111111111111"
  previous_release="$api_releases_root/git-222222222222"
  stale_release="$api_releases_root/git-333333333333"
  pending_release="$api_releases_root/git-444444444444"
  mkdir -- "$current_release" "$previous_release" "$stale_release" "$pending_release"
  chmod 0555 -- "$current_release" "$previous_release" "$stale_release" "$pending_release"
  mkdir -- "$api_releases_root/.staging.orphan"
  posix_modes=true
  if [[ -n "$(find "$stale_release" -perm /0222 -print -quit)" ]]; then
    # NTFS under Git for Windows does not persist chmod(0555). The same test
    # runs fully on Linux; keep journal/pointer durability coverage locally.
    posix_modes=false
  fi

  atomic_link "$current_release" "$current_api"
  atomic_link "$previous_release" "$previous_api"
  atomic_link "$current_release" "$slots_root/blue"
  atomic_link "$previous_release" "$slots_root/green"

  candidate_slot=green
  candidate_unit=openbmb-native-api@green.service
  old_upstream=127.0.0.1:13101
  target_upstream=127.0.0.1:13102
  old_slot=blue
  old_current_api="$current_release"
  old_previous_api="$previous_release"
  old_slot_target="$previous_release"
  target_release="$pending_release"
  write_journal prepared
  load_journal
  [[ "$journal_phase" == prepared && "$target_release" == "$pending_release" ]]

  if [[ "$posix_modes" == true ]]; then
    dry_run="$(gc_command --dry-run)"
    grep -Fqx 'retain git-111111111111' <<<"$dry_run"
    grep -Fqx 'retain git-222222222222' <<<"$dry_run"
    grep -Fqx 'would-delete git-333333333333' <<<"$dry_run"
    grep -Fqx 'retain git-444444444444' <<<"$dry_run"
    grep -Fqx 'would-delete-scratch .staging.orphan' <<<"$dry_run"

    gc_command --execute >/dev/null
    [[ -d "$current_release" && -d "$previous_release" && -d "$pending_release" ]]
    [[ ! -e "$stale_release" && ! -e "$api_releases_root/.staging.orphan" ]]
  else
    printf 'SKIP: release GC execution requires a filesystem that persists POSIX write modes\n' >&2
  fi
  durable_remove "$deployment_pending"
  if [[ "$posix_modes" == true ]]; then
    gc_command --execute >/dev/null
    [[ ! -e "$pending_release" ]]
  fi
)
rm -rf -- "$state_fixture"
state_fixture=''

# Exercise the exact GNU tar/PAX options used by the bootstrap exporter.
fixture="$(mktemp -d)"
long_directory="$fixture/payload/node_modules/example/$(printf 'long-segment-%.0s' {1..12})"
mkdir -p -- "$long_directory"
printf '{}\n' >"$fixture/payload/manifest.json"
printf 'fixture\n' >"$long_directory/index.js"
ln "$long_directory/index.js" "$long_directory/hardlink.js"
[[ "$(stat -c '%d:%i' "$long_directory/index.js")" == \
   "$(stat -c '%d:%i' "$long_directory/hardlink.js")" ]]
tar --create --gzip --file "$fixture/api.tar.gz" \
  --directory "$fixture" \
  --format=pax \
  --hard-dereference \
  --sort=name \
  --mtime='@0' \
  --owner=0 --group=0 --numeric-owner \
  --pax-option=delete=atime,delete=ctime \
  payload
digest="$(sha256sum "$fixture/api.tar.gz" | awk '{print $1}')"
printf '%s  api.tar.gz\n' "$digest" >"$fixture/api.tar.gz.sha256"
node "$script_dir/artifact-tool.mjs" verify-archive \
  --archive "$fixture/api.tar.gz" \
  --sha256 "$fixture/api.tar.gz.sha256" >/dev/null
[[ "$(tar --list --verbose --file "$fixture/api.tar.gz" | grep -c ' link to ')" -eq 0 ]]
