#!/usr/bin/env bash

set -euo pipefail

if [[ "$(basename -- "$0")" == "npx" ]]; then
  if [[ "${1:-}" == "prisma" && "${2:-}" == "validate" ]]; then
    exit 0
  fi

  if [[ "${1:-}" == "prisma" && "${2:-}" == "version" ]]; then
    printf 'fixture Prisma version\n'
    exit 0
  fi

  if [[ "${1:-}" != "prisma" || "${2:-}" != "migrate" || "${3:-}" != "diff" ]]; then
    printf 'Unexpected fixture command: %s\n' "$*" >&2
    exit 65
  fi

  : "${FAKE_DIFF_STATUSES:?}"
  : "${FAKE_DIFF_STATE_DIR:?}"

  call=1
  while ! mkdir -- "$FAKE_DIFF_STATE_DIR/call-$call" 2>/dev/null; do
    call=$((call + 1))
  done

  IFS=',' read -r -a statuses <<< "$FAKE_DIFF_STATUSES"
  index=$((call - 1))
  if (( index >= ${#statuses[@]} )); then
    index=$((${#statuses[@]} - 1))
  fi

  status="${statuses[$index]}"
  if [[ "$status" == "1" ]]; then
    printf 'Error: Error in Schema engine: fixture failure\n' >&2
  fi
  exit "$status"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="$script_dir/verify-prisma-schema-equivalence.sh"
fixture_root="$(mktemp -d)"
fake_npx="$fixture_root/npx"
self="$script_dir/$(basename -- "${BASH_SOURCE[0]}")"

cleanup() {
  local path
  for path in "$fixture_root"/state-*/call-*; do
    [[ -d "$path" ]] && rmdir -- "$path"
  done
  for path in "$fixture_root"/state-*; do
    [[ -d "$path" ]] && rmdir -- "$path"
  done
  [[ -e "$fake_npx" || -L "$fake_npx" ]] && rm -- "$fake_npx"
  rmdir -- "$fixture_root"
}
trap cleanup EXIT

ln -s -- "$self" "$fake_npx"

run_case() {
  local name="$1"
  local statuses="$2"
  local expected_status="$3"
  local expected_calls="$4"
  local state_dir="$fixture_root/state-$name"
  local output
  local actual_status
  local calls
  local call_paths
  local path

  mkdir -- "$state_dir"

  set +e
  output="$({
    PRISMA_NPX_BIN="$fake_npx" \
      PRISMA_SCHEMA_DIFF_MAX_ATTEMPTS=3 \
      FAKE_DIFF_STATUSES="$statuses" \
      FAKE_DIFF_STATE_DIR="$state_dir" \
      "$subject"
  } 2>&1)"
  actual_status=$?
  set -e

  call_paths=("$state_dir"/call-*)
  calls=0
  for path in "${call_paths[@]}"; do
    [[ -d "$path" ]] && calls=$((calls + 1))
  done

  if [[ "$actual_status" != "$expected_status" || "$calls" != "$expected_calls" ]]; then
    printf \
      'Case %s failed: status=%s (expected %s), calls=%s (expected %s).\n%s\n' \
      "$name" \
      "$actual_status" \
      "$expected_status" \
      "$calls" \
      "$expected_calls" \
      "$output" >&2
    exit 1
  fi
}

run_case equivalent '0' 0 1
run_case transient-engine-failure '1,0' 0 2
run_case documented-drift '2' 2 1
run_case persistent-engine-failure '1,1,1' 1 3
run_case unexpected-status '7' 7 1

printf 'Prisma schema equivalence guard fixtures: OK\n'
