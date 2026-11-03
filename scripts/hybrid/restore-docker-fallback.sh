#!/usr/bin/env bash
# Restore missing images only. Never activate a container or rewrite an existing tag.
set -Eeuo pipefail
umask 077
fail() { printf 'DOCKER FALLBACK: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 && $# -eq 1 && "$1" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]] || fail 'root and registry login are required'
[[ -n "${GH_TOKEN:-}" ]] || fail 'registry credential is unavailable'
actor="$1"
operation_lock=/run/lock/openbmb-operation.lock
[[ -f "$operation_lock" && ! -L "$operation_lock" && "$(stat -c %u "$operation_lock")" == 0 ]] || fail 'unsafe production operation lock'
[[ -z "$(find "$operation_lock" -maxdepth 0 -perm /0022 -print -quit)" ]] || fail 'writable operation lock'
exec 9<>"$operation_lock"
flock --exclusive --wait 120 --conflict-exit-code 75 9 || fail 'production operation is busy'
export OPENBMB_OPERATION_LOCK="$operation_lock"
export OPENBMB_OPERATION_LOCK_HELD=true
export OPENBMB_OPERATION_LOCK_FD=9
if [[ -x /usr/local/sbin/openbmb-runtime-mode ]]; then
  status="$(/usr/local/sbin/openbmb-runtime-mode status)"
  [[ "$(sed -n 's/^pending=//p' <<<"$status")" == no ]] || fail 'runtime transition is pending'
fi
[[ -L /opt/openbmb/current-app ]] || fail 'current-app is not a release pointer'
anchor="$(readlink -f /opt/openbmb/current-app)"
[[ "$(dirname -- "$anchor")" == /opt/openbmb/releases && "$(basename -- "$anchor")" =~ ^git-[0-9a-f]{12}$ ]] || fail 'invalid anchor'
[[ -d "$anchor" && ! -L "$anchor" && "$(stat -c %u "$anchor")" == 0 ]] || fail 'unsafe anchor'
[[ -z "$(find "$anchor" -xdev \( ! -user root -o -perm /0022 -o -type l \) -print -quit)" ]] || fail 'untrusted anchor contents'
for file in .openbmb-images .openbmb-transport-digests .openbmb-release-sha; do
  [[ -f "$anchor/$file" && ! -L "$anchor/$file" && "$(stat -c %u "$anchor/$file")" == 0 ]] || fail 'unsafe fallback attestation'
  [[ -z "$(find "$anchor/$file" -maxdepth 0 -perm /0022 -print -quit)" ]] || fail 'writable fallback attestation'
done
sha="$(cat "$anchor/.openbmb-release-sha")"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$(basename -- "$anchor")" == "git-${sha:0:12}" ]] || fail 'invalid anchor identity'
release_id="git-${sha:0:12}"
auth_dir="$(mktemp -d /run/openbmb-fallback-auth.XXXXXX)"
cleanup() {
  [[ "$auth_dir" == /run/openbmb-fallback-auth.* && -d "$auth_dir" && ! -L "$auth_dir" ]] || return
  rm -rf -- "$auth_dir"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$GH_TOKEN" | timeout 60 docker --config "$auth_dir" login ghcr.io --username "$actor" --password-stdin >/dev/null || fail 'GHCR authentication failed; fallback unchanged'
unset GH_TOKEN
for component in api migrator client-web admin-web; do
  image="openbmb-$component:$release_id"
  expected="$(awk -v image="$image" '$1 == image { n++; value=$2; if (NF != 2) exit 1 } END { if (n != 1) exit 1; print value }' "$anchor/.openbmb-images")" || fail 'missing or duplicate image attestation'
  [[ "$expected" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid image digest'
  transport="$(awk -v image="$image" '$1 == image { n++; value=$2 " " $3; if (NF != 3) exit 1 } END { if (n != 1) exit 1; print value }' "$anchor/.openbmb-transport-digests")" || fail 'missing or duplicate transport attestation'
  read -r ref digest extra <<<"$transport"
  [[ "$ref" =~ ^ghcr\.io/[a-z0-9][a-z0-9-]*/memory-lighthouse-delivery:[a-z0-9-]+$ && "$digest" =~ ^sha256:[0-9a-f]{64}$ && -z "${extra:-}" ]] || fail 'invalid pinned transport'
  if actual="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)"; then
    [[ "$actual" == "$expected" ]] || fail 'existing fallback tag has a different identity; refusing overwrite'
  else
    pinned="${ref%%:*}@$digest"
    timeout 900 docker --config "$auth_dir" pull "$pinned" || fail 'cannot read pinned GHCR digest (check package access); refusing fallback replacement'
    actual="$(docker image inspect --format '{{.Id}}' "$pinned")"
    [[ "$actual" == "$expected" ]] || fail 'downloaded digest does not match original image identity'
    revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$pinned")"
    [[ "$revision" == "$sha" ]] || fail 'downloaded image has a different source revision'
    if raced="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)"; then
      [[ "$raced" == "$expected" ]] || fail 'fallback tag appeared with a different identity; refusing overwrite'
    else
      docker tag "$pinned" "$image"
    fi
  fi
  revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  [[ "$revision" == "$sha" ]] || fail 'fallback image has a different source revision'
done
OPENBMB_INFRA_ENV_FILE=/etc/openbmb/infra.env OPENBMB_API_ENV_FILE=/etc/openbmb/api.env \
  bash "$anchor/infra/production/scripts/verify-release-images.sh"
printf 'Exact Docker fallback verified; no containers or data were changed.\n'
