#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
domain=''
node_bin='/opt/openbmb/runtime/node-v22.19.0-linux-x64/bin/node'
libexec_dir='/usr/local/libexec/openbmb-native-api'
api_releases_root='/opt/openbmb/hybrid/api-releases'
slots_root='/opt/openbmb/hybrid/api-slots'
hosts_file='/etc/openbmb/native-api.hosts'
native_env='/etc/openbmb/native-api.env'
unsafe_path=''

fail() { printf 'NATIVE API INSTALL: %s\n' "$*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    *) fail "unknown or incomplete option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail 'must run as root'
[[ "$domain" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || \
  fail 'domain must be a DNS hostname'
domain="${domain,,}"
[[ -x "$node_bin" && "$($node_bin --version)" == v22.19.0 ]] || \
  fail "fixed Node v22.19.0 is missing; run export-current-container.sh first"
[[ "$(stat -c %u -- "$node_bin")" == 0 ]] || fail 'fixed Node runtime must be root-owned'
unsafe_path="$(find "$node_bin" -maxdepth 0 -perm /0022 -print -quit)"
[[ -z "$unsafe_path" ]] || fail 'fixed Node runtime must not be writable by group or other users'

if ! getent group openbmb >/dev/null; then
  groupadd --system openbmb
fi
if ! getent passwd openbmb >/dev/null; then
  useradd --system --gid openbmb --home-dir /nonexistent --no-create-home \
    --shell /usr/sbin/nologin --comment 'OpenBMB native application' openbmb
fi
[[ "$(id -gn openbmb)" == openbmb ]] || fail 'openbmb user has an unexpected primary group'

for env_file in /etc/openbmb/infra.env /etc/openbmb/api.env; do
  [[ -f "$env_file" && ! -L "$env_file" ]] || fail "missing secure environment file: $env_file"
  [[ "$(stat -c %u -- "$env_file")" == 0 ]] || fail "$env_file must be root-owned"
  unsafe_path="$(find "$env_file" -maxdepth 0 -perm /0022 -print -quit)"
  if [[ -n "$unsafe_path" ]]; then
    fail "$env_file must not be writable by group or other users"
  fi
done

# The renderer deliberately refuses group-readable source credentials. Tighten
# both files before it opens either one; Docker/Compose operations run as root
# and remain compatible with these stricter permissions.
chown root:root -- /etc/openbmb/infra.env /etc/openbmb/api.env
chmod 0600 -- /etc/openbmb/infra.env /etc/openbmb/api.env
sync -f -- /etc/openbmb/infra.env /etc/openbmb/api.env

install -d -o root -g root -m 0755 \
  /opt/openbmb/hybrid "$api_releases_root" "$slots_root" \
  /opt/openbmb/runtime \
  /opt/openbmb/runtime/node-v22.19.0-linux-x64 \
  /opt/openbmb/runtime/node-v22.19.0-linux-x64/bin \
  "$libexec_dir" /usr/local/sbin /etc/openbmb /etc/systemd/system

atomic_install() {
  local source="$1" destination="$2" mode="$3" temporary
  temporary="${destination}.new.$$"
  install -o root -g root -m "$mode" "$source" "$temporary"
  sync -f -- "$temporary"
  mv -Tf -- "$temporary" "$destination"
  sync -f -- "$(dirname -- "$destination")"
}

atomic_install "$script_dir/runtime-lib.mjs" "$libexec_dir/runtime-lib.mjs" 0444
atomic_install "$script_dir/launcher.mjs" "$libexec_dir/launcher.mjs" 0555
atomic_install "$script_dir/artifact-tool.mjs" "$libexec_dir/artifact-tool.mjs" 0555
atomic_install "$script_dir/render-native-env.mjs" "$libexec_dir/render-native-env.mjs" 0555
atomic_install "$script_dir/deploy-native-api.sh" /usr/local/sbin/openbmb-deploy-native-api 0555
atomic_install "$script_dir/export-current-container.sh" /usr/local/sbin/openbmb-export-current-api-container 0555
atomic_install "$script_dir/../../systemd/openbmb-native-api@.service" \
  /etc/systemd/system/openbmb-native-api@.service 0444

# Only this minimized, derived file is readable by the runtime UID. The source
# files were already tightened to root-only before rendering, so an application
# RCE cannot read infrastructure root/KMS/LiveKit-Redis credentials.
native_env_temporary="${native_env}.new.$$"
"$node_bin" "$libexec_dir/render-native-env.mjs" \
  --infra /etc/openbmb/infra.env \
  --api /etc/openbmb/api.env >"$native_env_temporary"
[[ -s "$native_env_temporary" ]] || fail 'derived native API environment is empty'
chown root:openbmb -- "$native_env_temporary"
chmod 0640 -- "$native_env_temporary"
sync -f -- "$native_env_temporary"
mv -Tf -- "$native_env_temporary" "$native_env"
sync -f -- /etc/openbmb

hosts_temporary="${hosts_file}.new.$$"
host_name="$(hostname --short)"
[[ "$host_name" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$ ]] || fail 'system hostname is unsafe'
{
  printf '127.0.0.1 localhost %s %s\n' "$host_name" "$domain"
  printf '::1 localhost ip6-localhost ip6-loopback\n'
  printf 'ff02::1 ip6-allnodes\n'
  printf 'ff02::2 ip6-allrouters\n'
} >"$hosts_temporary"
chown root:root -- "$hosts_temporary"
chmod 0644 -- "$hosts_temporary"
sync -f -- "$hosts_temporary"
mv -Tf -- "$hosts_temporary" "$hosts_file"
sync -f -- /etc/openbmb

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/openbmb-native-api@.service
printf 'Installed native API delivery module. No blue/green instance was enabled or started.\n'
