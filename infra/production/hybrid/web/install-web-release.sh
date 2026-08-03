#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

[[ "$EUID" -eq 0 ]] || { printf 'installer must run as root\n' >&2; exit 1; }

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_entry="$script_dir/openbmb-web-release"
source_guard="$script_dir/archive_guard.py"
entry_destination=/usr/local/sbin/openbmb-web-release
guard_directory=/usr/local/libexec/openbmb-web-release
guard_destination="$guard_directory/archive_guard.py"

for source in "$source_entry" "$source_guard"; do
  [[ -f "$source" && ! -L "$source" ]] || {
    printf 'implementation source is missing or linked: %s\n' "$source" >&2
    exit 1
  }
done
bash -n "$source_entry"
python3 "$source_guard" --help >/dev/null
command -v zstd >/dev/null 2>&1 || {
  printf 'zstd is required before installing Web release support\n' >&2
  exit 1
}
id ubuntu >/dev/null 2>&1 || { printf 'ubuntu account is required\n' >&2; exit 1; }
id caddy >/dev/null 2>&1 || { printf 'caddy account is required\n' >&2; exit 1; }
getent group openbmb >/dev/null 2>&1 || {
  printf 'openbmb group is required before installing Web release support\n' >&2
  exit 1
}

for destination in "$entry_destination" "$guard_destination"; do
  [[ ! -L "$destination" ]] || {
    printf 'refusing to replace a linked installation target: %s\n' "$destination" >&2
    exit 1
  }
done

for managed_directory in \
  /opt/openbmb \
  /opt/openbmb/hybrid \
  /opt/openbmb/hybrid/web-releases \
  /var/lib/openbmb/web-release \
  /var/lib/openbmb/web-release/staging \
  /var/lib/openbmb/web-release/promotions \
  /var/lib/openbmb/web-release/gc-candidates \
  /home/ubuntu/.openbmb-web-incoming; do
  [[ ! -L "$managed_directory" ]] || {
    printf 'refusing to use a linked managed directory: %s\n' "$managed_directory" >&2
    exit 1
  }
done

install -d -o root -g root -m 0755 /usr/local/sbin /usr/local/libexec "$guard_directory"
# Preserve the root:openbmb ownership required by the guarded Docker fallback.
# Other users receive traverse-only access so Caddy can follow current-web,
# without gaining directory-list or /etc/openbmb credential access.
install -d -o root -g openbmb -m 0751 /opt/openbmb
install -d -o root -g root -m 0755 \
  /opt/openbmb/hybrid \
  /opt/openbmb/hybrid/web-releases
install -d -o root -g root -m 0700 \
  /var/lib/openbmb/web-release \
  /var/lib/openbmb/web-release/staging \
  /var/lib/openbmb/web-release/promotions \
  /var/lib/openbmb/web-release/gc-candidates
install -d -o ubuntu -g ubuntu -m 0700 /home/ubuntu/.openbmb-web-incoming

atomic_install() {
  local source="$1"
  local destination="$2"
  local mode="$3"
  local parent temporary
  parent="$(dirname -- "$destination")"
  temporary="$(mktemp "$parent/.openbmb-install.XXXXXX")"
  install -o root -g root -m "$mode" "$source" "$temporary"
  python3 -c 'import os, sys; fd=os.open(sys.argv[1], os.O_RDONLY); os.fsync(fd); os.close(fd)' \
    "$temporary"
  mv -Tf -- "$temporary" "$destination"
  python3 -c 'import os, sys; fd=os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY); os.fsync(fd); os.close(fd)' \
    "$parent"
}

# The helper goes first.  Both versions share the same private command interface,
# so an already-installed entry remains usable during the atomic entry update.
atomic_install "$source_guard" "$guard_destination" 0755
atomic_install "$source_entry" "$entry_destination" 0755

printf 'installed %s\n' "$entry_destination"
