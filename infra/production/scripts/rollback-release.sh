#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  printf 'usage: %s <release-id>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi
if [[ "${ROLLBACK_SCHEMA_COMPATIBLE:-}" != yes ]]; then
  printf 'Set ROLLBACK_SCHEMA_COMPATIBLE=yes only after confirming the target app is compatible with the current schema.\n' >&2
  exit 1
fi

release_id="$1"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'unsafe release id\n' >&2
  exit 1
}

releases_root="${OPENBMB_RELEASES_ROOT:-/opt/openbmb/releases}"
current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
target="$releases_root/$release_id"
target="$(readlink -f -- "$target")"
case "$target" in
  "$releases_root"/*) ;;
  *) printf 'rollback target escaped the release root\n' >&2; exit 1 ;;
esac
[[ -f "$target/infra/production/scripts/compose.sh" ]] || {
  printf 'target is not a complete release: %s\n' "$target" >&2
  exit 1
}

for image in \
  "openbmb-api:$release_id" \
  "openbmb-client-web:$release_id" \
  "openbmb-admin-web:$release_id"; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    printf 'rollback image is missing: %s\n' "$image" >&2
    exit 1
  }
done

OPENBMB_RELEASE="$release_id" \
  bash "$target/infra/production/scripts/compose.sh" \
  up -d --no-build api client-web admin-web
OPENBMB_RELEASE="$release_id" \
  bash "$target/infra/production/scripts/health-check.sh" --local

temporary_link="${current_link}.new"
ln -sfn -- "$target" "$temporary_link"
mv -Tf -- "$temporary_link" "$current_link"
printf 'Application containers rolled back to %s; data volumes were not changed.\n' "$release_id"
