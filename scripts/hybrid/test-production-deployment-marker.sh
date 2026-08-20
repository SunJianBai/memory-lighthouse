#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
marker="$script_dir/production-deployment-marker.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-deployment-marker-test.XXXXXX")"

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  rm -rf -- "$test_root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

bin_dir="$test_root/bin"
mkdir -p -- "$bin_dir"
cat >"$bin_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
request="${*: -1}"
if [[ " $* " == *' --method POST '* ]]; then
  [[ "$request" == repos/example/memory-lighthouse/deployments/30/statuses ]]
  payload="$(cat)"
  [[ "$payload" == '{"state":"success","description":"OPENBMB API DEPLOYED cccccccccccccccccccccccccccccccccccccccc","log_url":"https://github.example/example/memory-lighthouse/actions/runs/4242","auto_inactive":false}' ]]
  printf 'success\tOPENBMB API DEPLOYED cccccccccccccccccccccccccccccccccccccccc\n'
  exit 0
fi
case "$request" in
  repos/example/memory-lighthouse/deployments\?environment=production\&per_page=100)
    # IDs model automatic environment deployments whose GitHub deployment.sha
    # can differ from the validated source. Selection must be newest-first and
    # must not add a source-SHA query filter.
    [[ " $* " == *'sort_by([.created_at, .id]) | reverse'* ]]
    printf '30\n20\n10\n'
    ;;
  repos/example/memory-lighthouse/deployments/30/statuses)
    if [[ " $* " == *'/actions/runs/4242/'* ]]; then
      printf '1\n'
    else
      printf '\n'
    fi
    ;;
  repos/example/memory-lighthouse/deployments/20/statuses)
    if [[ " $* " == *'/actions/runs/4242/'* ]]; then
      printf '1\n'
    else
      printf '\n'
    fi
    ;;
  repos/example/memory-lighthouse/deployments/10/statuses)
    if [[ " $* " == *'/actions/runs/4242/'* ]]; then
      printf '0\n'
    else
      printf 'OPENBMB API DEPLOYED aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
    fi
    ;;
  *)
    printf 'unexpected gh request: %s\n' "$request" >&2
    exit 1
    ;;
esac
EOF
chmod 0700 "$bin_dir/gh"
cat >"$bin_dir/jq" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
description=''
log_url=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --arg)
      case "$2" in
        description) description="$3" ;;
        log_url) log_url="$3" ;;
        *) exit 64 ;;
      esac
      shift 3
      ;;
    *) shift ;;
  esac
done
printf '{"state":"success","description":"%s","log_url":"%s","auto_inactive":false}\n' \
  "$description" "$log_url"
EOF
chmod 0700 "$bin_dir/jq"

baseline="$(
  PATH="$bin_dir:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/memory-lighthouse \
    bash "$marker" read api
)"
[[ "$baseline" == aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ]] || {
  printf 'deployment marker selected the wrong baseline: %s\n' "$baseline" >&2
  exit 1
}

PATH="$bin_dir:$PATH" \
  GH_TOKEN=test-token \
  GITHUB_REPOSITORY=example/memory-lighthouse \
  GITHUB_SERVER_URL=https://github.example \
  bash "$marker" mark api cccccccccccccccccccccccccccccccccccccccc 4242 DEPLOYED

printf 'Production deployment marker tests passed.\n'
