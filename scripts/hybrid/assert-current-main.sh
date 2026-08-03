#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

[[ "$#" -eq 1 ]] || {
  printf 'usage: scripts/hybrid/assert-current-main.sh <source-sha40>\n' >&2
  exit 64
}

source_sha="${1,,}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'source SHA must be 40 lowercase hexadecimal characters\n' >&2
  exit 64
}

repository="${GITHUB_REPOSITORY:-}"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  printf 'GITHUB_REPOSITORY is missing or invalid\n' >&2
  exit 69
}
[[ -n "${GH_TOKEN:-}" ]] || {
  printf 'GH_TOKEN is required to recheck the protected main ref\n' >&2
  exit 69
}
command -v gh >/dev/null || {
  printf 'gh is required to recheck the protected main ref\n' >&2
  exit 69
}

current_main="$({
  gh api --method GET "repos/$repository/git/ref/heads/main" --jq '.object.sha'
} 2>/dev/null)" || {
  printf 'could not read the current remote main ref\n' >&2
  exit 69
}
[[ "$current_main" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'remote main returned an invalid commit identity\n' >&2
  exit 65
}
[[ "$current_main" == "$source_sha" ]] || {
  printf 'refusing stale promotion: validated=%s current-main=%s\n' \
    "$source_sha" "$current_main" >&2
  exit 75
}

printf 'Remote main still points to validated commit %s.\n' "$source_sha"
