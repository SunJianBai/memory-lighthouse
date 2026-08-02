#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
prisma_npx_bin="${PRISMA_NPX_BIN:-npx}"
max_attempts="${PRISMA_SCHEMA_DIFF_MAX_ATTEMPTS:-3}"

if [[ ! "$max_attempts" =~ ^[1-5]$ ]]; then
  printf 'PRISMA_SCHEMA_DIFF_MAX_ATTEMPTS must be an integer from 1 to 5.\n' >&2
  exit 64
fi

cd -- "$repo_root"

"$prisma_npx_bin" prisma validate \
  --config docs/refactor/database/prisma.config.ts

attempt=1
while (( attempt <= max_attempts )); do
  set +e
  "$prisma_npx_bin" prisma migrate diff \
    --from-schema apps/server-api/prisma/schema.prisma \
    --to-schema docs/refactor/database/schema.prisma \
    --exit-code
  status=$?
  set -e

  # `prisma migrate diff --exit-code` reserves 2 for a non-empty diff and 1
  # for a command error. Never retry or mask an actual documented-model drift.
  case "$status" in
    0)
      exit 0
      ;;
    2)
      printf 'Documented database model differs from the application Prisma schema.\n' >&2
      exit 2
      ;;
    1)
      if (( attempt < max_attempts )); then
        printf \
          'Prisma schema diff command failed (attempt %s/%s); retrying the schema engine.\n' \
          "$attempt" \
          "$max_attempts" >&2
        attempt=$((attempt + 1))
        continue
      fi

      printf \
        'Prisma schema diff command failed after %s attempts; version diagnostics follow.\n' \
        "$max_attempts" >&2
      "$prisma_npx_bin" prisma version >&2 || true
      exit 1
      ;;
    *)
      printf 'Prisma schema diff exited with unexpected status %s.\n' "$status" >&2
      exit "$status"
      ;;
  esac
done
