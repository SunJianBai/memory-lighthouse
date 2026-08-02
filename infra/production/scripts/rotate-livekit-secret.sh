#!/usr/bin/env bash
set -Eeuo pipefail

infra_env="${1:-${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}}"
temporary_env_file=''

cleanup_temporary_env() {
  if [[ -n "$temporary_env_file" ]]; then
    rm -f -- "$temporary_env_file"
  fi
}
trap cleanup_temporary_env EXIT

fail() {
  printf 'LIVEKIT SECRET ROTATION: %s\n' "$*" >&2
  exit 1
}

[[ "$infra_env" == /* && "$infra_env" != *$'\n'* ]] || \
  fail 'infrastructure env path must be absolute and contain no newlines'
[[ -f "$infra_env" && ! -L "$infra_env" ]] || \
  fail "infrastructure env must be a regular non-symlink: $infra_env"
if [[ "$infra_env" == /etc/openbmb/infra.env ]]; then
  [[ "$(id -u)" == 0 && "$(stat -c %u -- "$infra_env")" == 0 ]] || \
    fail 'the production infrastructure env must be rotated by root and owned by root'
fi
if find "$infra_env" -maxdepth 0 -perm /0037 -print -quit | grep -q .; then
  fail 'infrastructure env must use mode 0640 or stricter'
fi

assert_container_stopped() {
  local container_name="$1"
  local container_ids
  local running

  container_ids="$(
    docker container ls --all --format '{{.ID}} {{.Names}}' |
      awk -v wanted="$container_name" '$2 == wanted { print $1 }'
  )"
  if [[ -z "$container_ids" ]]; then
    return
  fi
  [[ "$container_ids" != *$'\n'* ]] || \
    fail "multiple containers unexpectedly use the $container_name name"
  running="$(docker inspect --format '{{.State.Running}}' "$container_ids")"
  [[ "$running" == false ]] || \
    fail "$container_name must be stopped before LiveKit secret rotation"
}

if [[ "$infra_env" == /etc/openbmb/infra.env ]]; then
  command -v docker >/dev/null 2>&1 || fail 'docker is required to verify the production stop boundary'
  assert_container_stopped openbmb-api
  assert_container_stopped openbmb-livekit
fi

old_secret=''
secret_count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == LIVEKIT_API_SECRET=* ]]; then
    secret_count=$((secret_count + 1))
    old_secret="${line#LIVEKIT_API_SECRET=}"
  fi
done <"$infra_env"
[[ "$secret_count" -eq 1 ]] || \
  fail 'infrastructure env must contain exactly one LIVEKIT_API_SECRET assignment'
[[ "$old_secret" =~ ^[A-Za-z0-9_-]{32,}$ ]] || \
  fail 'existing LIVEKIT_API_SECRET is not a valid base64url value'

new_secret=''
for _attempt in 1 2 3; do
  new_secret="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\r\n')"
  if [[ "$new_secret" =~ ^[A-Za-z0-9_-]{64}$ && "$new_secret" != "$old_secret" ]]; then
    break
  fi
  new_secret=''
done
[[ -n "$new_secret" ]] || fail 'could not generate a distinct LiveKit API secret'

env_directory="$(dirname -- "$infra_env")"
temporary_env_file="$(mktemp -- "$env_directory/.infra.env.livekit.XXXXXX")"
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == LIVEKIT_API_SECRET=* ]]; then
    printf 'LIVEKIT_API_SECRET=%s\n' "$new_secret"
  else
    printf '%s\n' "$line"
  fi
done <"$infra_env" >"$temporary_env_file"

chmod --reference="$infra_env" -- "$temporary_env_file"
if [[ "$(id -u)" == 0 ]]; then
  chown --reference="$infra_env" -- "$temporary_env_file"
fi
[[ "$(stat -c %u:%g -- "$temporary_env_file")" == "$(stat -c %u:%g -- "$infra_env")" ]] || \
  fail 'temporary env ownership differs from the original'
[[ "$(stat -c %a -- "$temporary_env_file")" == "$(stat -c %a -- "$infra_env")" ]] || \
  fail 'temporary env mode differs from the original'

sync -f -- "$temporary_env_file"
mv -Tf -- "$temporary_env_file" "$infra_env"
temporary_env_file=''
sync -f -- "$env_directory"

# Deliberately emit nothing on success. In particular, neither the old nor the
# replacement secret may enter deployment logs.
