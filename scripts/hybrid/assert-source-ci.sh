#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
[[ $# -ge 1 && $# -le 2 && "$1" =~ ^[0-9a-f]{40}$ ]] || exit 64
source_sha="$1"
run_id="${2:-}"
repository="${GITHUB_REPOSITORY:-}"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && -n "${GH_TOKEN:-}" ]] || exit 69
# A workflow_run context's default github.sha is not the business source SHA.
# Reusable/manual callers must independently prove successful CI for that SHA.
if [[ -n "$run_id" ]]; then
  [[ "$run_id" =~ ^[1-9][0-9]*$ ]] || exit 64
  evidence="$(gh api "repos/$repository/actions/runs/$run_id")"
  jq -e --arg sha "$source_sha" --arg repo "$repository" '
    .head_sha == $sha and .head_branch == "main" and .event == "push" and
    .conclusion == "success" and .status == "completed" and
    .path == ".github/workflows/ci.yml" and .head_repository.full_name == $repo
  ' <<<"$evidence" >/dev/null
else
  evidence="$(gh api --method GET "repos/$repository/actions/workflows/ci.yml/runs" \
    -f head_sha="$source_sha" -f branch=main -f event=push -f status=success -f per_page=100)"
  jq -e --arg sha "$source_sha" --arg repo "$repository" '
    any(.workflow_runs[]; .head_sha == $sha and .head_branch == "main" and
      .event == "push" and .conclusion == "success" and .status == "completed" and
      .path == ".github/workflows/ci.yml" and .head_repository.full_name == $repo)
  ' <<<"$evidence" >/dev/null
fi
printf 'Successful same-source main CI verified for %s.\n' "$source_sha"
