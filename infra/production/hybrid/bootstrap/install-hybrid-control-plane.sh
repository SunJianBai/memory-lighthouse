#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
hybrid_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
domain=''

fail() {
  printf 'HYBRID INSTALL: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --domain)
      domain="${2:-}"
      shift 2
      ;;
    *) fail "unknown or incomplete option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail 'must run as root'
[[ "$domain" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || \
  fail 'domain must be a DNS hostname'

for source in \
  "$script_dir/bootstrap-lib.sh" \
  "$script_dir/openbmb-switch-api-upstream" \
  "$script_dir/openbmb-hybrid-health" \
  "$script_dir/openbmb-runtime-mode" \
  "$script_dir/openbmb-stack-control" \
  "$script_dir/openbmb-backup-control" \
  "$script_dir/openbmb-bootstrap-api-cutover" \
  "$script_dir/migrate-from-docker.sh" \
  "$hybrid_dir/../systemd/openbmb-hybrid-recovery.service" \
  "$hybrid_dir/../systemd/caddy-openbmb-hybrid-recovery.conf" \
  "$hybrid_dir/../systemd/openbmb.service" \
  "$hybrid_dir/../systemd/openbmb-hybrid.conf" \
  "$hybrid_dir/../systemd/openbmb-backup.service" \
  "$hybrid_dir/../systemd/openbmb-backup-hybrid.conf" \
  "$hybrid_dir/web/install-web-release.sh" \
  "$hybrid_dir/api/install-native-api.sh"; do
  [[ -f "$source" && ! -L "$source" ]] || fail "missing installation source: $source"
done
bash -n "$script_dir/openbmb-switch-api-upstream"
bash -n "$script_dir/openbmb-hybrid-health"
bash -n "$script_dir/openbmb-runtime-mode"
bash -n "$script_dir/openbmb-stack-control"
bash -n "$script_dir/openbmb-backup-control"
bash -n "$script_dir/openbmb-bootstrap-api-cutover"
bash -n "$script_dir/migrate-from-docker.sh"

# Module-owned installers retain responsibility for their private state and
# implementation files. This top-level installer owns only the two cross-module
# adapters that form the stable operations interface.
bash "$hybrid_dir/api/install-native-api.sh" --domain "$domain"
bash "$hybrid_dir/web/install-web-release.sh"

install_atomic() {
  local source="$1"
  local destination="$2"
  local mode="$3"
  local parent
  local temporary

  parent="$(dirname -- "$destination")"
  install -d -o root -g root -m 0755 "$parent"
  [[ ! -L "$destination" ]] || fail "refusing to replace linked target: $destination"
  temporary="$(mktemp -- "$parent/.openbmb-install.XXXXXX")"
  install -o root -g root -m "$mode" "$source" "$temporary"
  sync -f -- "$temporary"
  mv -Tf -- "$temporary" "$destination"
  sync -f -- "$parent"
}

install_atomic "$script_dir/openbmb-switch-api-upstream" \
  /usr/local/libexec/openbmb-switch-api-upstream 0555
install_atomic "$script_dir/bootstrap-lib.sh" \
  /usr/local/libexec/openbmb-hybrid/bootstrap-lib.sh 0444
install_atomic "$script_dir/openbmb-hybrid-health" \
  /usr/local/sbin/openbmb-hybrid-health 0555
install_atomic "$script_dir/openbmb-runtime-mode" \
  /usr/local/sbin/openbmb-runtime-mode 0555
install_atomic "$script_dir/openbmb-stack-control" \
  /usr/local/sbin/openbmb-stack-control 0555
install_atomic "$script_dir/openbmb-backup-control" \
  /usr/local/sbin/openbmb-backup-control 0555
install_atomic "$script_dir/openbmb-bootstrap-api-cutover" \
  /usr/local/libexec/openbmb-bootstrap-api-cutover 0555
install_atomic "$script_dir/migrate-from-docker.sh" \
  /usr/local/sbin/openbmb-migrate-from-docker 0555
install_atomic "$hybrid_dir/../systemd/openbmb-hybrid-recovery.service" \
  /etc/systemd/system/openbmb-hybrid-recovery.service 0444
install_atomic "$hybrid_dir/../systemd/caddy-openbmb-hybrid-recovery.conf" \
  /etc/systemd/system/caddy.service.d/openbmb-hybrid-recovery.conf 0444
install_atomic "$hybrid_dir/../systemd/openbmb.service" \
  /etc/systemd/system/openbmb.service 0444
install_atomic "$hybrid_dir/../systemd/openbmb-hybrid.conf" \
  /etc/systemd/system/openbmb.service.d/hybrid-runtime.conf 0444
install_atomic "$hybrid_dir/../systemd/openbmb-backup.service" \
  /etc/systemd/system/openbmb-backup.service 0444
install_atomic "$hybrid_dir/../systemd/openbmb-backup-hybrid.conf" \
  /etc/systemd/system/openbmb-backup.service.d/hybrid-runtime.conf 0444

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/openbmb-hybrid-recovery.service
systemd-analyze verify caddy.service
systemd-analyze verify openbmb.service
systemd-analyze verify openbmb-backup.service
systemctl enable openbmb.service >/dev/null
# Keep the recovery oneshot active as the current-boot barrier. Caddy and the
# legacy stack both Require it; RemainAfterExit prevents a later Caddy start
# inside a locked runtime transition from recursively re-running recovery.
systemctl enable --now openbmb-hybrid-recovery.service >/dev/null
systemctl is-active --quiet openbmb-hybrid-recovery.service || \
  fail 'hybrid recovery barrier did not become active'

current_upstream="$(/usr/local/libexec/openbmb-switch-api-upstream current)"
[[ "$current_upstream" =~ ^127\.0\.0\.1:1310[0-2]$ ]] || \
  fail 'installed Caddy adapter returned an unmanaged upstream'

printf 'Installed hybrid control plane; current API upstream remains %s.\n' \
  "$current_upstream"
