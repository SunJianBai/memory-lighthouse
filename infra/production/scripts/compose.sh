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

exec docker compose \
  --project-name openbmb \
  --env-file "$infra_env" \
  --file "$project_root/infra/compose/compose.yml" \
  --file "$production_dir/compose.production.yml" \
  "$@"
