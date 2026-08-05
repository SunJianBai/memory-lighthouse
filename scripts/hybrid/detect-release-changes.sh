#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

usage() {
  cat >&2 <<'EOF'
usage: scripts/hybrid/detect-release-changes.sh api|web <source-sha40> <workflow-run-id>

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
workflow_run_id="$3"

[[ "$component" =~ ^(api|web)$ ]] || {
  usage
  exit 64
}
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'source SHA must be 40 lowercase hexadecimal characters\n' >&2
  exit 64
}
[[ "$workflow_run_id" =~ ^[1-9][0-9]*$ ]] || {
  printf 'Change detector: missing workflow run; conservatively publishing %s.\n' "$component" >&2
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

trigger_identity="$(
  gh api "repos/$repository/actions/runs/$workflow_run_id" \
    --jq '[.head_sha, .event, .head_branch, .conclusion] | @tsv' 2>/dev/null || true
)"
trigger_sha=''
trigger_event=''
trigger_branch=''
trigger_conclusion=''
extra=''
read -r trigger_sha trigger_event trigger_branch trigger_conclusion extra <<<"$trigger_identity"
if [[ "$trigger_sha" != "$source_sha" || "$trigger_event" != push || \
      "$trigger_branch" != main || "$trigger_conclusion" != success || -n "$extra" ]]; then
  printf 'Change detector: triggering CI run is unavailable or mismatched; conservatively publishing %s.\n' \
    "$component" >&2
  printf 'true\n'
  exit 0
fi

baseline_candidates="$(
  gh api --paginate \
    "repos/$repository/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100" \
    --jq '.workflow_runs[].head_sha' 2>/dev/null || true
)"
before_sha=''
while IFS= read -r candidate; do
  [[ "$candidate" =~ ^[0-9a-f]{40}$ && "$candidate" != "$source_sha" ]] || continue
  if git cat-file -e "$candidate^{commit}" 2>/dev/null && \
     git merge-base --is-ancestor "$candidate" "$source_sha"; then
    before_sha="$candidate"
    break
  fi
done <<<"$baseline_candidates"

if [[ -z "$before_sha" ]]; then
  printf 'Change detector: no prior successful main CI ancestor is available; conservatively publishing %s.\n' \
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
