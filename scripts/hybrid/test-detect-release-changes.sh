#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
detector="$script_dir/detect-release-changes.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-change-detector-test.XXXXXX")"

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

repository="$test_root/repository"
bin_dir="$test_root/bin"
mkdir -p -- "$repository/apps/server-api" "$repository/docs" "$bin_dir"
git -C "$repository" init --quiet --initial-branch=main
git -C "$repository" config user.name 'Delivery Test'
git -C "$repository" config user.email 'delivery-test@example.invalid'
git -C "$repository" config core.autocrlf false

printf 'api-v1\n' >"$repository/apps/server-api/version.txt"
git -C "$repository" add apps/server-api/version.txt
git -C "$repository" commit --quiet -m 'initial API release'
production_sha="$(git -C "$repository" rev-parse HEAD)"

printf 'api-v2\n' >"$repository/apps/server-api/version.txt"
git -C "$repository" add apps/server-api/version.txt
git -C "$repository" commit --quiet -m 'API change whose delivery fails'
api_change_sha="$(git -C "$repository" rev-parse HEAD)"

printf 'documentation only\n' >"$repository/docs/readme.txt"
git -C "$repository" add docs/readme.txt
git -C "$repository" commit --quiet -m 'unrelated follow-up commit'
source_sha="$(git -C "$repository" rev-parse HEAD)"

cat >"$bin_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\tpush\tmain\tsuccess\n' "${TEST_SOURCE_SHA:?}"
EOF
chmod 0700 "$bin_dir/gh"

actual="$({
  cd -- "$repository"
  PATH="$bin_dir:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/memory-lighthouse \
    TEST_SOURCE_SHA="$source_sha" \
    bash "$detector" api "$source_sha" 4242 "$production_sha"
})"

[[ "$actual" == true ]] || {
  printf 'failed promotion was not reconciled: expected true, got %s\n' "$actual" >&2
  exit 1
}

actual="$({
  cd -- "$repository"
  PATH="$bin_dir:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/memory-lighthouse \
    TEST_SOURCE_SHA="$source_sha" \
    bash "$detector" api "$source_sha" 4242 "$api_change_sha"
})"

[[ "$actual" == false ]] || {
  printf 'successful production baseline did not skip an unrelated change: expected false, got %s\n' \
    "$actual" >&2
  exit 1
}

actual="$({
  cd -- "$repository"
  PATH="$bin_dir:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/memory-lighthouse \
    TEST_SOURCE_SHA="$source_sha" \
    bash "$detector" api "$source_sha" 4242 ffffffffffffffffffffffffffffffffffffffff
})"

[[ "$actual" == true ]] || {
  printf 'unverifiable production baseline did not fail open: expected true, got %s\n' \
    "$actual" >&2
  exit 1
}

mkdir -p -- "$repository/apps/client-web"
printf 'web-v2\n' >"$repository/apps/client-web/version.txt"
git -C "$repository" add apps/client-web/version.txt
git -C "$repository" commit --quiet -m 'Web-only change'
web_source_sha="$(git -C "$repository" rev-parse HEAD)"

actual="$({
  cd -- "$repository"
  PATH="$bin_dir:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/memory-lighthouse \
    TEST_SOURCE_SHA="$web_source_sha" \
    bash "$detector" web "$web_source_sha" 4242 "$source_sha"
})"

[[ "$actual" == true ]] || {
  printf 'Web change was not selected for reconciliation: expected true, got %s\n' "$actual" >&2
  exit 1
}

actual="$({
  cd -- "$repository"
  PATH="$bin_dir:$PATH" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/memory-lighthouse \
    TEST_SOURCE_SHA="$web_source_sha" \
    bash "$detector" api "$web_source_sha" 4242 "$source_sha"
})"

[[ "$actual" == false ]] || {
  printf 'API filter selected a Web-only change: expected false, got %s\n' "$actual" >&2
  exit 1
}

printf 'Change detector reconciliation tests passed.\n'
