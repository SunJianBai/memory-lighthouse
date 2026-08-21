#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "$script_dir/../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-package-api-cache-test.XXXXXX")"

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

fixture="$test_root/repository"
output_dir="$test_root/output"
wrapper_dir="$test_root/bin"
mkdir -p -- \
  "$fixture/scripts/hybrid" \
  "$fixture/infra/production/hybrid/api" \
  "$fixture/infra/production/compatibility" \
  "$fixture/apps/server-api/dist" \
  "$fixture/apps/server-api/prisma" \
  "$fixture/apps/server-api/node_modules/.bin" \
  "$fixture/apps/server-api/node_modules/.cache/jiti" \
  "$fixture/apps/server-api/node_modules/empty-package/lib" \
  "$fixture/node_modules/runtime-package" \
  "$fixture/node_modules/.cache/jiti" \
  "$output_dir" \
  "$wrapper_dir"

cp -- "$script_dir/package-api.sh" "$fixture/scripts/hybrid/package-api.sh"
cp -- \
  "$project_root/infra/production/hybrid/api/artifact-tool.mjs" \
  "$project_root/infra/production/hybrid/api/runtime-lib.mjs" \
  "$fixture/infra/production/hybrid/api/"

printf '1\n' >"$fixture/infra/production/compatibility/security-epoch"
printf 'module.exports = {};\n' >"$fixture/apps/server-api/dist/main.js"
printf '{"name":"fixture-server","private":true}\n' >"$fixture/apps/server-api/package.json"
printf 'datasource db { provider = "mysql" }\n' >"$fixture/apps/server-api/prisma/schema.prisma"
printf 'module.exports = "runtime";\n' >"$fixture/node_modules/runtime-package/index.js"
printf 'temporary root cache\n' >"$fixture/node_modules/.cache/jiti/root-cache.mjs"
printf 'temporary Prisma config cache\n' \
  >"$fixture/apps/server-api/node_modules/.cache/jiti/server-api-prisma.config.mjs"

git -C "$fixture" init -q
git -C "$fixture" config core.autocrlf false
git -C "$fixture" config user.name 'OpenBMB fixture'
git -C "$fixture" config user.email 'fixture@example.invalid'
git -C "$fixture" add -f .
git -C "$fixture" -c commit.gpgSign=false commit -qm fixture
source_sha="$(git -C "$fixture" rev-parse HEAD)"

real_node="$(command -v node)"
[[ -n "$real_node" ]]
{
  printf '#!/usr/bin/env bash\n'
  printf 'if [[ "${1:-}" == --version ]]; then printf "v22.19.0\\n"; exit 0; fi\n'
  printf 'exec %q "$@"\n' "$real_node"
} >"$wrapper_dir/node"
chmod 0700 -- "$wrapper_dir/node"

archive="$output_dir/openbmb-native-api-git-${source_sha:0:12}.tar.gz"
if ! package_output="$(
  PATH="$wrapper_dir:$PATH" \
    bash "$fixture/scripts/hybrid/package-api.sh" "$source_sha" "$archive" 2>&1
)"; then
  printf 'package-api cache regression failed:\n%s\n' "$package_output" >&2
  exit 1
fi

tar_members="$(tar --list --file "$archive")"
grep -Fq 'payload/node_modules/runtime-package/index.js' <<<"$tar_members"
if grep -F '/.cache/' <<<"$tar_members"; then
  printf 'package-api included an ephemeral node_modules cache\n' >&2
  exit 1
fi
if grep -Fq 'payload/apps/server-api/node_modules' <<<"$tar_members"; then
  printf 'package-api retained empty workspace node_modules directories\n' >&2
  exit 1
fi

printf 'API package cache and empty-directory policy test passed.\n'
