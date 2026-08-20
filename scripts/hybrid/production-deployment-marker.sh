#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

usage() {
  cat >&2 <<'EOF'
usage:
  scripts/hybrid/production-deployment-marker.sh read api|web
  scripts/hybrid/production-deployment-marker.sh mark api|web <source-sha40> <run-id> DEPLOYED|RECONCILED

Reads or records a component reconciliation marker on the GitHub deployment
created by the protected production job. Read failures must be handled as an
empty baseline by the caller so release planning fails open.
EOF
}

[[ "$#" -ge 2 ]] || {
  usage
  exit 64
}

command_name="$1"
component="$2"
[[ "$command_name" =~ ^(read|mark)$ && "$component" =~ ^(api|web)$ ]] || {
  usage
  exit 64
}

repository="${GITHUB_REPOSITORY:-}"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && -n "${GH_TOKEN:-}" ]] || {
  printf 'deployment marker: GitHub identity is unavailable\n' >&2
  exit 69
}
for required_command in gh jq; do
  command -v "$required_command" >/dev/null || {
    printf 'deployment marker: required command is unavailable: %s\n' "$required_command" >&2
    exit 69
  }
done

case "$component" in
  api) component_label=API ;;
  web) component_label=WEB ;;
esac

read_marker() {
  local deployments deployment_id marker_description
  deployments="$(
    gh api \
      --jq 'sort_by([.created_at, .id]) | reverse | .[].id' \
      "repos/$repository/deployments?environment=production&per_page=100"
  )" || return 1

  while IFS= read -r deployment_id; do
    [[ "$deployment_id" =~ ^[1-9][0-9]*$ ]] || continue
    marker_description="$(
      gh api \
        --jq '[.[] | select(.state == "success" and ((.description // "") | test("^OPENBMB '"$component_label"' (DEPLOYED|RECONCILED) [0-9a-f]{40}$"))) | .description] | first // ""' \
        "repos/$repository/deployments/$deployment_id/statuses" 2>/dev/null || true
    )"
    [[ "$marker_description" =~ ^OPENBMB[[:space:]]$component_label[[:space:]](DEPLOYED|RECONCILED)[[:space:]]([0-9a-f]{40})$ ]] || \
      continue
    printf '%s\n' "${BASH_REMATCH[2]}"
    return 0
  done <<<"$deployments"
  printf '\n'
}

mark_deployment() {
  [[ "$#" -eq 3 ]] || {
    usage
    exit 64
  }
  local source_sha="${1,,}"
  local run_id="$2"
  local result="$3"
  local deployments deployment_id match_count candidate_id=''
  local description payload response
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[1-9][0-9]*$ && \
     "$result" =~ ^(DEPLOYED|RECONCILED)$ ]] || {
    usage
    exit 64
  }

  deployments="$(
    gh api \
      --jq 'sort_by([.created_at, .id]) | reverse | .[].id' \
      "repos/$repository/deployments?environment=production&per_page=100"
  )"
  while IFS= read -r deployment_id; do
    [[ "$deployment_id" =~ ^[1-9][0-9]*$ ]] || continue
    match_count="$(
      gh api \
        --jq '[.[] | select(((.log_url // "") | contains("/actions/runs/'"$run_id"'/")))] | length' \
        "repos/$repository/deployments/$deployment_id/statuses"
    )" || continue
    [[ "$match_count" =~ ^[1-9][0-9]*$ ]] || continue
    candidate_id="$deployment_id"
    # A workflow rerun keeps GITHUB_RUN_ID but can create another environment
    # deployment. The API list is explicitly newest-first, so the first match
    # is the deployment belonging to the latest attempt of this run.
    break
  done <<<"$deployments"
  [[ -n "$candidate_id" ]] || {
    printf 'deployment marker: found no production deployment for run %s\n' \
      "$run_id" >&2
    exit 65
  }

  description="OPENBMB $component_label $result $source_sha"
  payload="$(
    jq -nc \
      --arg description "$description" \
      --arg log_url "${GITHUB_SERVER_URL:-https://github.com}/$repository/actions/runs/$run_id" \
      '{state:"success", description:$description, log_url:$log_url, auto_inactive:false}'
  )"
  response="$(
    gh api \
      --method POST \
      --input - \
      --jq '[.state, .description] | @tsv' \
      "repos/$repository/deployments/$candidate_id/statuses" <<<"$payload"
  )"
  [[ "$response" == $'success\t'"$description" ]] || {
    printf 'deployment marker: GitHub did not persist the expected marker\n' >&2
    exit 65
  }
  printf 'Recorded %s marker for %s at %s.\n' "$result" "$component" "$source_sha"
}

case "$command_name" in
  read)
    [[ "$#" -eq 2 ]] || {
      usage
      exit 64
    }
    read_marker
    ;;
  mark)
    shift 2
    mark_deployment "$@"
    ;;
esac
