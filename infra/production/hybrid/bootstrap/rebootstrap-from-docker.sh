#!/usr/bin/env bash
set -Eeuo pipefail

# Explicit operator entry point. The migration implementation owns validation,
# input pinning, the global lock, durable journals, health, and Docker recovery.
exec "${OPENBMB_MIGRATE_FROM_DOCKER_BIN:-/usr/local/sbin/openbmb-migrate-from-docker}" \
  --reviewed-rebootstrap "$@"
