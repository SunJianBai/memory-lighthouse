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

if "$ssh_command" -O check "$ssh_host" >/dev/null 2>&1; then
  printf 'Reused authenticated SSH master for %s.\n' "$ssh_host"
  exit 0
fi

# Retrying this connection is safe because -N starts no remote command. The host
# profile deliberately uses ProxyCommand=/bin/false, so only this explicit override
# may open a network connection. Normal ssh/scp calls fail closed without a master.
for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if "$ssh_command" -MNf \
       -o ProxyCommand=none \
       -o ControlMaster=yes \
       -o ControlPersist=130m \
       "$ssh_host" && \
     "$ssh_command" -O check "$ssh_host" >/dev/null 2>&1; then
    printf 'Established authenticated SSH master for %s.\n' "$ssh_host"
    exit 0
  fi

  if (( attempt < attempts )); then
    printf 'SSH authentication/handshake failed for %s (attempt %s/%s); retrying.\n' \
      "$ssh_host" "$attempt" "$attempts" >&2
    sleep "$((base_delay_seconds * attempt))"
  fi
done

printf 'SSH authentication/handshake retries exhausted for %s.\n' "$ssh_host" >&2
exit 1
