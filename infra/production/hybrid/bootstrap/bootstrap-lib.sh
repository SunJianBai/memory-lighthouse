#!/usr/bin/env bash

# Shared primitives for the root-owned hybrid runtime control plane. Callers
# must already use `set -Eeuo pipefail`.

hybrid_expected_uid="${OPENBMB_EXPECTED_UID:-0}"
hybrid_sync_bin="${OPENBMB_SYNC_BIN:-sync}"

hybrid_die() {
  printf 'HYBRID CONTROL: %s\n' "$*" >&2
  return 1
}

hybrid_require_root() {
  [[ "$(id -u)" == "$hybrid_expected_uid" ]] || \
    { hybrid_die "must run as UID $hybrid_expected_uid"; return 1; }
}

hybrid_assert_absolute() {
  [[ "$1" == /* && "$1" != / && "$1" != *$'\n'* ]] || \
    { hybrid_die "managed path must be an absolute non-root path: $1"; return 1; }
}

hybrid_stat_mode() {
  printf '%s\n' "$((8#$(stat -c %a -- "$1")))"
}

hybrid_assert_root_directory() {
  local path="$1" mode
  hybrid_assert_absolute "$path" || return 1
  [[ -d "$path" && ! -L "$path" ]] || { hybrid_die "unsafe managed directory: $path"; return 1; }
  [[ "$(stat -c %u -- "$path")" == "$hybrid_expected_uid" ]] || \
    { hybrid_die "managed directory has an unexpected owner: $path"; return 1; }
  mode="$(hybrid_stat_mode "$path")"
  (( (mode & 8#0022) == 0 )) || { hybrid_die "managed directory is writable by group/other: $path"; return 1; }
}

hybrid_assert_secure_file() {
  local path="$1" mode
  [[ -f "$path" && ! -L "$path" ]] || { hybrid_die "unsafe managed file: $path"; return 1; }
  [[ "$(stat -c %u -- "$path")" == "$hybrid_expected_uid" ]] || \
    { hybrid_die "managed file has an unexpected owner: $path"; return 1; }
  mode="$(hybrid_stat_mode "$path")"
  (( (mode & 8#0022) == 0 )) || { hybrid_die "managed file is writable by group/other: $path"; return 1; }
}

# /run/lock is intentionally 1777 on Ubuntu. A verified root-owned file cannot
# be replaced there by another user because of the sticky bit. Never chmod the
# shared directory; create the lock without truncating and then prove both the
# parent and file invariants before opening it.
hybrid_prepare_lock_file() {
  local path="$1" parent mode
  hybrid_assert_absolute "$path" || return 1
  parent="$(dirname -- "$path")"
  [[ -d "$parent" && ! -L "$parent" ]] || { hybrid_die "unsafe lock parent: $parent"; return 1; }
  [[ "$(stat -c %u -- "$parent")" == "$hybrid_expected_uid" ]] || \
    { hybrid_die "lock parent has an unexpected owner: $parent"; return 1; }
  mode="$(hybrid_stat_mode "$parent")"
  if (( (mode & 8#0022) != 0 && (mode & 8#1000) == 0 )); then
    hybrid_die "writable lock parent is not sticky: $parent"
    return 1
  fi

  if [[ ! -e "$path" && ! -L "$path" ]]; then
    (umask 077; set -o noclobber; : >"$path") 2>/dev/null || true
  fi
  hybrid_assert_secure_file "$path" || return 1
}

# A child process may reuse the caller's production-operation lock only when
# the inherited descriptor still names the exact verified lock inode. Calling
# flock on the inherited open-file description is idempotent and also ensures
# a falsely advertised but otherwise valid descriptor becomes locked before
# the child mutates state.
hybrid_assert_inherited_lock() {
  local path="$1" fd="$2" flock_command="$3" descriptor
  [[ "$fd" =~ ^([3-9]|[1-9][0-9]+)$ ]] || {
    hybrid_die 'inherited operation-lock descriptor is missing'
    return 1
  }
  descriptor="/proc/$$/fd/$fd"
  [[ -e "$descriptor" ]] || {
    hybrid_die 'inherited operation-lock descriptor is closed'
    return 1
  }
  [[ "$(stat -Lc %d:%i -- "$descriptor")" == "$(stat -Lc %d:%i -- "$path")" ]] || {
    hybrid_die 'inherited descriptor does not reference the production operation lock'
    return 1
  }
  "$flock_command" --exclusive --wait 0 --conflict-exit-code 75 "$fd" || {
    hybrid_die 'inherited production operation lock is not held'
    return 1
  }
}

hybrid_fsync_file() {
  "$hybrid_sync_bin" -f -- "$1" 2>/dev/null || "$hybrid_sync_bin"
}

hybrid_fsync_directory() {
  "$hybrid_sync_bin" -f -- "$1" 2>/dev/null || "$hybrid_sync_bin"
}

hybrid_atomic_commit_file() {
  local temporary="$1" destination="$2" parent
  parent="$(dirname -- "$destination")"
  hybrid_fsync_file "$temporary"
  mv -Tf -- "$temporary" "$destination"
  hybrid_fsync_directory "$parent"
}

hybrid_atomic_remove() {
  local path="$1" parent
  parent="$(dirname -- "$path")"
  rm -f -- "$path"
  hybrid_fsync_directory "$parent"
}

# Copy only from the inode that was opened and checked. This prevents a caller
# path in an upload/staging directory from being exchanged after validation.
hybrid_pin_file() {
  local source="$1" destination="$2" mode="$3" group="$4"
  local fd descriptor metadata owner source_mode temporary parent
  hybrid_assert_absolute "$source" || return 1
  hybrid_assert_absolute "$destination" || return 1
  parent="$(dirname -- "$destination")"
  hybrid_assert_root_directory "$parent" || return 1

  exec {fd}<"$source"
  descriptor="/proc/$$/fd/$fd"
  [[ -f "$descriptor" ]] || {
    exec {fd}<&-
    hybrid_die "input is not a regular file: $source"
    return 1
  }
  metadata="$(stat -Lc '%u|%a' "$descriptor")"
  IFS='|' read -r owner source_mode <<<"$metadata"
  [[ "$owner" == "$hybrid_expected_uid" ]] || {
    exec {fd}<&-
    hybrid_die "input is not owned by UID $hybrid_expected_uid: $source"
    return 1
  }
  (( (8#$source_mode & 8#0022) == 0 )) || {
    exec {fd}<&-
    hybrid_die "input is writable by group/other: $source"
    return 1
  }

  temporary="$(mktemp -- "$parent/.openbmb-pin.XXXXXX")"
  if ! cp --reflink=auto -- "$descriptor" "$temporary"; then
    exec {fd}<&-
    rm -f -- "$temporary"
    hybrid_die "could not pin input: $source"
    return 1
  fi
  exec {fd}<&-
  chown "$hybrid_expected_uid:$group" -- "$temporary"
  chmod "$mode" -- "$temporary"
  hybrid_atomic_commit_file "$temporary" "$destination"
  hybrid_assert_secure_file "$destination" || return 1
}

hybrid_write_scalar() {
  local destination="$1" mode="$2" group="$3" value="$4"
  local parent temporary
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { hybrid_die 'scalar value contains a newline'; return 1; }
  parent="$(dirname -- "$destination")"
  hybrid_assert_root_directory "$parent" || return 1
  temporary="$(mktemp -- "$parent/.openbmb-write.XXXXXX")"
  printf '%s\n' "$value" >"$temporary"
  chown "$hybrid_expected_uid:$group" -- "$temporary"
  chmod "$mode" -- "$temporary"
  hybrid_atomic_commit_file "$temporary" "$destination"
}
