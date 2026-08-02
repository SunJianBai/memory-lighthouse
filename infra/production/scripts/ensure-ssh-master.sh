#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  printf 'usage: %s <ssh-host> [attempts] [base-delay-seconds]\n' \
    "${BASH_SOURCE[0]}" >&2
  exit 2
fi

ssh_host="$1"
attempts="${2:-6}"
base_delay_seconds="${3:-5}"

[[ "$ssh_host" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  printf 'SSH host alias is invalid\n' >&2
  exit 1
}
[[ "$attempts" =~ ^[1-9][0-9]*$ && "$attempts" -le 6 ]] || {
  printf 'SSH master attempt count must be between 1 and 6\n' >&2
  exit 1
}
[[ "$base_delay_seconds" =~ ^(0|[1-9][0-9]*)$ && "$base_delay_seconds" -le 30 ]] || {
  printf 'SSH master base retry delay must be between 0 and 30 seconds\n' >&2
  exit 1
}

ssh_command="${OPENBMB_SSH_COMMAND:-$(command -v ssh)}"
[[ "$ssh_command" == /* && -x "$ssh_command" && ! -d "$ssh_command" ]] || {
  printf 'SSH command path must be an absolute executable file\n' >&2
  exit 1
}

ssh_child_pid=''
ssh_child_spawn_in_progress=false
pending_signal_status=''
terminate_helper() {
  local signal_status="$1"
  trap - HUP INT TERM
  if [[ -n "$ssh_child_pid" ]]; then
    kill "$ssh_child_pid" >/dev/null 2>&1 || true
    wait "$ssh_child_pid" >/dev/null 2>&1 || true
  fi
  exit "$signal_status"
}

request_helper_termination() {
  local signal_status="$1"
  if [[ "$ssh_child_spawn_in_progress" == true ]]; then
    pending_signal_status="$signal_status"
    return
  fi
  terminate_helper "$signal_status"
}
trap 'request_helper_termination 129' HUP
trap 'request_helper_termination 130' INT
trap 'request_helper_termination 143' TERM

run_child() {
  local child_status=0
  ssh_child_spawn_in_progress=true
  "$@" </dev/null &
  ssh_child_pid=$!
  ssh_child_spawn_in_progress=false
  if [[ -n "$pending_signal_status" ]]; then
    terminate_helper "$pending_signal_status"
  fi
  wait "$ssh_child_pid" || child_status=$?
  ssh_child_pid=''
  return "$child_status"
}

ssh_config="$("$ssh_command" -G -T "$ssh_host" </dev/null 2>/dev/null)" || {
  printf 'failed to resolve SSH control path for %s\n' "$ssh_host" >&2
  exit 1
}
mapfile -t control_paths < <(
  awk '$1 == "controlpath" && NF == 2 { print $2 }' <<< "$ssh_config"
)
[[ "${#control_paths[@]}" -eq 1 ]] || {
  printf 'SSH host %s must resolve exactly one control path\n' "$ssh_host" >&2
  exit 1
}
ssh_dir="$HOME/.ssh"
[[ -d "$ssh_dir" && ! -L "$ssh_dir" ]] || {
  printf 'SSH directory is missing or unsafe\n' >&2
  exit 1
}
resolved_ssh_dir="$(readlink -f -- "$ssh_dir")"
[[ "$(stat -c %u "$resolved_ssh_dir")" -eq "$EUID" && \
   -z "$(find "$resolved_ssh_dir" -maxdepth 0 -perm /0077 -print -quit)" ]] || {
  printf 'SSH directory must be private and owned by the current user\n' >&2
  exit 1
}
control_path="${control_paths[0]}"
control_parent="$(dirname -- "$control_path")"
control_name="$(basename -- "$control_path")"
control_prefix="openbmb-$ssh_host-"
control_hash="${control_name#"$control_prefix"}"
[[ "$control_path" == /* && -d "$control_parent" && ! -L "$control_parent" && \
   "$(readlink -f -- "$control_parent")" == "$resolved_ssh_dir" && \
   "$control_name" == "$control_prefix$control_hash" && \
   "$control_hash" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'SSH control path is outside the pinned private namespace for %s\n' \
    "$ssh_host" >&2
  exit 1
}

validate_existing_control_socket() {
  if [[ ! -e "$control_path" && ! -L "$control_path" ]]; then
    return 0
  fi
  [[ -S "$control_path" && ! -L "$control_path" && -O "$control_path" ]] || {
    printf 'SSH control path is not a private user-owned socket for %s\n' \
      "$ssh_host" >&2
    return 1
  }
}
validate_existing_control_socket || exit 1

if run_child "$ssh_command" -O check "$ssh_host" >/dev/null 2>&1; then
  printf 'Reused authenticated SSH master for %s.\n' "$ssh_host"
  exit 0
fi

remove_stale_control_socket() {
  if [[ ! -e "$control_path" && ! -L "$control_path" ]]; then
    return 0
  fi
  validate_existing_control_socket || return 1
  if run_child "$ssh_command" -O check "$ssh_host" >/dev/null 2>&1; then
    return 2
  fi
  validate_existing_control_socket || return 1
  rm -f -- "$control_path"
  [[ ! -e "$control_path" && ! -L "$control_path" ]]
}

# Retrying this connection is safe because -N starts no remote command. The host
# profile deliberately uses ProxyCommand=/bin/false, so only this explicit override
# may open a network connection. Normal ssh/scp calls fail closed without a master.
for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if run_child "$ssh_command" -O check "$ssh_host" >/dev/null 2>&1; then
    printf 'Reused authenticated SSH master for %s.\n' "$ssh_host"
    exit 0
  fi
  stale_status=0
  remove_stale_control_socket || stale_status=$?
  if [[ "$stale_status" -eq 2 ]]; then
    printf 'Reused authenticated SSH master for %s.\n' "$ssh_host"
    exit 0
  fi
  [[ "$stale_status" -eq 0 ]] || exit "$stale_status"

  run_child "$ssh_command" -MNf \
       -o ProxyCommand=none \
       -o ControlMaster=yes \
       -o ControlPersist=130m \
       "$ssh_host" || true
  if run_child "$ssh_command" -O check "$ssh_host" >/dev/null 2>&1; then
    printf 'Established authenticated SSH master for %s.\n' "$ssh_host"
    exit 0
  fi

  if (( attempt < attempts )); then
    printf 'SSH authentication/handshake failed for %s (attempt %s/%s); retrying.\n' \
      "$ssh_host" "$attempt" "$attempts" >&2
    run_child sleep "$((base_delay_seconds * attempt))"
  fi
done

printf 'SSH authentication/handshake retries exhausted for %s.\n' "$ssh_host" >&2
exit 1
