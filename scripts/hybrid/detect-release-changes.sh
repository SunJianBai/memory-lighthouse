#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

usage() {
  cat >&2 <<'EOF'
usage: scripts/hybrid/detect-release-changes.sh api|web <source-sha40> <check-suite-id>

Prints exactly "true" or "false". An unavailable or untrusted push baseline
fails open to "true" so change detection can never suppress a required release.
EOF
}

[[ "$#" -eq 3 ]] || {
  usage
  exit 64
}

component="$1"
source_sha="${2,,}"
check_suite_id="$3"

[[ "$component" =~ ^(api|web)$ ]] || {
  usage
  exit 64
}
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'source SHA must be 40 lowercase hexadecimal characters\n' >&2
  exit 64
}
[[ "$check_suite_id" =~ ^[1-9][0-9]*$ ]] || {
  printf 'Change detector: missing check suite; conservatively publishing %s.\n' "$component" >&2
  printf 'true\n'
  exit 0
}

for command_name in gh git; do
  command -v "$command_name" >/dev/null || {
    printf 'Change detector: %s is unavailable; conservatively publishing %s.\n' \
      "$command_name" "$component" >&2
    printf 'true\n'
    exit 0
  }
done

repository="${GITHUB_REPOSITORY:-}"
if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ || -z "${GH_TOKEN:-}" ]]; then
  printf 'Change detector: GitHub identity is unavailable; conservatively publishing %s.\n' \
    "$component" >&2
  printf 'true\n'
  exit 0
fi

actual_head="$(git rev-parse HEAD)"
[[ "$actual_head" == "$source_sha" ]] || {
  printf 'checked-out HEAD does not match the validated source SHA\n' >&2
  exit 65
}

suite_range="$(
  gh api "repos/$repository/check-suites/$check_suite_id" \
    --jq '[.before_sha, .after_sha] | join(" ")' 2>/dev/null || true
)"
before_sha=''
after_sha=''
extra=''
read -r before_sha after_sha extra <<<"$suite_range"

if [[ ! "$before_sha" =~ ^[0-9a-f]{40}$ || ! "$after_sha" =~ ^[0-9a-f]{40}$ || \
      -n "$extra" || "$after_sha" != "$source_sha" ]]; then
  printf 'Change detector: check-suite range is unavailable or mismatched; conservatively publishing %s.\n' \
    "$component" >&2
  printf 'true\n'
  exit 0
fi

if [[ "$before_sha" == 0000000000000000000000000000000000000000 ]]; then
  printf 'Change detector: initial push has no baseline; publishing %s.\n' "$component" >&2
  printf 'true\n'
  exit 0
fi

if ! git cat-file -e "$before_sha^{commit}" 2>/dev/null || \
   ! git merge-base --is-ancestor "$before_sha" "$source_sha"; then
  printf 'Change detector: push baseline is not a trusted ancestor; conservatively publishing %s.\n' \
    "$component" >&2
  printf 'true\n'
  exit 0
fi

case "$component" in
  api)
    relevant_paths=(
      apps/server-api
      packages/api-contracts
      packages/event-contracts
      ':(top,glob)package*.json'
      infra/production/compatibility/security-epoch
    )
    ;;
  web)
    relevant_paths=(
      apps/client-web
      apps/admin-web
      design-system
      packages/api-contracts
      packages/event-contracts
      ':(top,glob)package*.json'
    )
    ;;
esac

set +e
git diff --quiet "$before_sha" "$source_sha" -- "${relevant_paths[@]}"
diff_status=$?
set -e
case "$diff_status" in
  0)
    printf 'Change detector: no %s source changed in %s..%s; skipping release.\n' \
      "$component" "$before_sha" "$source_sha" >&2
    printf 'false\n'
    ;;
  1)
    printf 'Change detector: %s source changed in %s..%s; publishing.\n' \
      "$component" "$before_sha" "$source_sha" >&2
    printf 'true\n'
    ;;
  *)
    printf 'Change detector: git diff failed; conservatively publishing %s.\n' "$component" >&2
    printf 'true\n'
    ;;
esac
