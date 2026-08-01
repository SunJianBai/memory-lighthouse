#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
project_root="$(CDPATH= cd -- "$production_dir/../.." && pwd -P)"

infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
if [[ ! -f "$infra_env" ]]; then
  printf 'OpenBMB infrastructure env file is missing: %s\n' "$infra_env" >&2
  exit 1
fi

release_id="${OPENBMB_RELEASE:-$(basename -- "$project_root")}"
if [[ ! "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  printf 'OPENBMB_RELEASE must be a safe immutable identifier.\n' >&2
  exit 1
fi
export OPENBMB_RELEASE="$release_id"

infrastructure_release="${OPENBMB_INFRASTRUCTURE_RELEASE:-$release_id}"
[[ "$infrastructure_release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'OPENBMB_INFRASTRUCTURE_RELEASE must be a safe immutable identifier.\n' >&2
  exit 1
}

application_release="${OPENBMB_APPLICATION_RELEASE:-}"
if [[ -z "$application_release" ]]; then
  current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
  application_link="${OPENBMB_APPLICATION_LINK:-/opt/openbmb/current-app}"
  current_target="$(readlink -f -- "$current_link" 2>/dev/null || true)"
  if [[ "$project_root" == "$current_target" && -L "$application_link" ]]; then
    application_target="$(readlink -f -- "$application_link")"
    releases_root="${OPENBMB_RELEASES_ROOT:-/opt/openbmb/releases}"
    case "$application_target" in
      "$releases_root"/*) ;;
      *) printf 'current application release escaped the release root.\n' >&2; exit 1 ;;
    esac
    [[ "$(dirname -- "$application_target")" == "$releases_root" ]] || {
      printf 'current application release must be directly below the release root.\n' >&2
      exit 1
    }
    application_release="$(basename -- "$application_target")"
  else
    application_release="$release_id"
  fi
fi
[[ "$application_release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'OPENBMB_APPLICATION_RELEASE must be a safe immutable identifier.\n' >&2
  exit 1
}
export OPENBMB_INFRASTRUCTURE_RELEASE="$infrastructure_release"
export OPENBMB_APPLICATION_RELEASE="$application_release"

exec docker compose \
  --project-name openbmb \
  --env-file "$infra_env" \
  --file "$project_root/infra/compose/compose.yml" \
  --file "$production_dir/compose.production.yml" \
  "$@"
