#!/usr/bin/env bash
set -Eeuo pipefail

assert_container_stopped() {
  local container_name="$1"
  local container_id
  container_id="$(
    docker container ls --all --filter "name=^/${container_name}$" --format '{{.ID}}'
  )"
  [[ "$container_id" != *$'\n'* ]] || {
    printf 'multiple containers unexpectedly use %s\n' "$container_name" >&2
    exit 1
  }
  if [[ -n "$container_id" ]]; then
    local running
    running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
    [[ "$running" == false ]] || {
      printf '%s must be stopped before realtime state is drained\n' "$container_name" >&2
      exit 1
    }
  fi
}

delete_matching_keys() {
  local container_name="$1"
  local user="$2"
  local password_variable="$3"
  local pattern="$4"
  local database="$5"
  [[ "$database" =~ ^[0-9]+$ ]] || {
    printf 'invalid Redis database for %s\n' "$container_name" >&2
    exit 1
  }
  local result
  result="$(
    docker exec "$container_name" sh -ec '
      password_variable="$1"
      user="$2"
      pattern="$3"
      database="$4"
      case "$password_variable" in
        REDIS_APP_PASSWORD) password="${REDIS_APP_PASSWORD:-}" ;;
        REDIS_LIVEKIT_PASSWORD) password="${REDIS_LIVEKIT_PASSWORD:-}" ;;
        *) exit 64 ;;
      esac
      [ -n "$password" ] || exit 64
      export REDISCLI_AUTH="$password"
      key_file="$(mktemp /tmp/openbmb-redis-drain.XXXXXX)"
      trap '\''rm -f -- "$key_file"'\'' EXIT HUP INT TERM
      deleted=0
      while :; do
        redis-cli --raw --no-auth-warning --user "$user" -n "$database" \
          --scan --pattern "$pattern" > "$key_file"
        [ -s "$key_file" ] || break
        while IFS= read -r key; do
          [ -n "$key" ] || continue
          removed="$(
            redis-cli --raw --no-auth-warning --user "$user" -n "$database" \
              UNLINK "$key"
          )"
          case "$removed" in
            0|1) deleted=$((deleted + removed)) ;;
            *) exit 65 ;;
          esac
        done < "$key_file"
      done
      printf "%s\n" "$deleted"
    ' sh "$password_variable" "$user" "$pattern" "$database" | tr -d '\r\n'
  )"
  [[ "$result" =~ ^[0-9]+$ ]] || {
    printf 'unexpected Redis drain result for %s\n' "$container_name" >&2
    exit 1
  }
  printf 'Drained %s realtime keys from %s.\n' "$result" "$container_name"
}

assert_container_stopped openbmb-api
assert_container_stopped openbmb-livekit

delete_matching_keys openbmb-redis openbmb-api REDIS_APP_PASSWORD \
  'openbmb:media-owner:*' 0
# redis-livekit is dedicated to this LiveKit node, so all of its ephemeral
# room, participant and routing keys must be empty before a new node starts.
delete_matching_keys openbmb-redis-livekit livekit REDIS_LIVEKIT_PASSWORD '*' 1
