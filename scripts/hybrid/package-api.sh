#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
umask 077

usage() {
  cat >&2 <<'EOF'
usage: scripts/hybrid/package-api.sh <commit40> <absolute-output.tar.gz>

Packages an already-built and production-pruned Linux server workspace into
the native API artifact consumed by openbmb-deploy-native-api.
EOF
}

[[ "$#" -eq 2 ]] || {
  usage
  exit 64
}

source_sha="${1,,}"
output_archive="$2"
output_sidecar="$output_archive.sha256"

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'commit must be exactly 40 lowercase hexadecimal characters\n' >&2
  exit 64
}
[[ "$output_archive" == /* && "$output_archive" == *.tar.gz ]] || {
  printf 'output archive must be an absolute .tar.gz path\n' >&2
  exit 64
}
expected_name="openbmb-native-api-git-${source_sha:0:12}.tar.gz"
[[ "$(basename -- "$output_archive")" == "$expected_name" ]] || {
  printf 'output archive basename must be %s\n' "$expected_name" >&2
  exit 64
}
for output in "$output_archive" "$output_sidecar"; do
  [[ ! -e "$output" && ! -L "$output" ]] || {
    printf 'refusing to overwrite output evidence: %s\n' "$output" >&2
    exit 73
  }
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "$script_dir/../.." && pwd -P)"
actual_root="$(git -C "$project_root" rev-parse --show-toplevel)"
actual_root="$(cd -- "$actual_root" && pwd -P)"
[[ "$actual_root" == "$project_root" ]] || {
  printf 'script is not running from the expected repository root\n' >&2
  exit 65
}
[[ "$(git -C "$project_root" rev-parse HEAD)" == "$source_sha" ]] || {
  printf 'repository HEAD does not match the requested source SHA\n' >&2
  exit 65
}
[[ -z "$(git -C "$project_root" status --porcelain=v1 --untracked-files=all)" ]] || {
  printf 'refusing to package a dirty worktree\n' >&2
  exit 65
}

for command_name in awk basename dirname du find git gzip mktemp node sha256sum tar; do
  command -v "$command_name" >/dev/null || {
    printf 'required command is missing: %s\n' "$command_name" >&2
    exit 69
  }
done
[[ "$(node --version)" == v22.19.0 ]] || {
  printf 'native API artifacts must be built with Node v22.19.0\n' >&2
  exit 69
}

artifact_tool="$project_root/infra/production/hybrid/api/artifact-tool.mjs"
security_epoch_file="$project_root/infra/production/compatibility/security-epoch"
prisma_root="$project_root/apps/server-api/prisma"
server_dist="$project_root/apps/server-api/dist"
server_package="$project_root/apps/server-api/package.json"
dependencies_root="$project_root/node_modules"
workspace_dependencies_root="$project_root/apps/server-api/node_modules"

[[ -f "$artifact_tool" && ! -L "$artifact_tool" ]] || {
  printf 'artifact tool is missing or linked\n' >&2
  exit 66
}
[[ -f "$security_epoch_file" && ! -L "$security_epoch_file" ]] || {
  printf 'security epoch is missing or linked\n' >&2
  exit 66
}
[[ -d "$prisma_root" && ! -L "$prisma_root" ]] || {
  printf 'Prisma source tree is missing or linked\n' >&2
  exit 66
}
[[ -f "$server_dist/main.js" && -f "$server_package" ]] || {
  printf 'server workspace must be built before packaging\n' >&2
  exit 66
}
[[ -d "$dependencies_root" && ! -L "$dependencies_root" ]] || {
  printf 'production node_modules is missing or linked\n' >&2
  exit 66
}
[[ ! -L "$workspace_dependencies_root" ]] || {
  printf 'workspace-local production node_modules must not be linked\n' >&2
  exit 66
}

mapfile -t epoch_lines <"$security_epoch_file"
[[ "${#epoch_lines[@]}" -eq 1 && "${epoch_lines[0]}" =~ ^[1-9][0-9]*$ ]] || {
  printf 'security epoch must contain one positive decimal integer\n' >&2
  exit 65
}

output_parent="$(dirname -- "$output_archive")"
[[ -d "$output_parent" && ! -L "$output_parent" ]] || {
  printf 'output parent must be an existing non-symlink directory\n' >&2
  exit 73
}
temporary_parent="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
[[ -d "$temporary_parent" && ! -L "$temporary_parent" ]] || {
  printf 'temporary parent must be an existing non-symlink directory\n' >&2
  exit 73
}

stage_root="$(mktemp -d "$temporary_parent/openbmb-api-stage.XXXXXX")"
verification_root=""
completed=false
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$verification_root" && -d "$verification_root" && ! -L "$verification_root" ]]; then
    rm -rf -- "$verification_root"
  fi
  if [[ -d "$stage_root" && ! -L "$stage_root" ]]; then
    rm -rf -- "$stage_root"
  fi
  if [[ "$completed" != true ]]; then
    rm -f -- "$output_archive" "$output_sidecar"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

payload="$stage_root/payload"
mkdir -m 0700 -- "$payload"

# npm workspaces leave a server-api link under node_modules. The running app is
# already present at apps/server-api, so exclude that self-link and dereference
# all remaining package/bin links. A production package may still be nested in
# apps/server-api/node_modules when npm cannot hoist it; include that directory
# when present. --hard-dereference ensures the final guarded archive contains
# only ordinary file members, never tar hard-link records.
payload_members=(
  node_modules
  apps/server-api/dist
  apps/server-api/package.json
)
if [[ -d "$workspace_dependencies_root" ]]; then
  payload_members+=(apps/server-api/node_modules)
fi
tar --create \
  --file - \
  --directory "$project_root" \
  --dereference \
  --hard-dereference \
  --exclude='node_modules/@memory-lighthouse/server-api' \
  "${payload_members[@]}" \
  | tar --extract \
      --file - \
      --directory "$payload" \
      --no-same-owner \
      --no-same-permissions

unsafe_path="$(find "$payload" \( -type l -o \( \! -type f -a \! -type d \) \) -print -quit)"
[[ -z "$unsafe_path" ]] || {
  printf 'staged payload contains a link or special file: %s\n' "$unsafe_path" >&2
  exit 65
}
[[ -f "$payload/apps/server-api/dist/main.js" ]] || {
  printf 'staged payload is missing dist/main.js\n' >&2
  exit 66
}

migrations_digest="$(node "$artifact_tool" tree-digest --root "$prisma_root")"
release_id="git-${source_sha:0:12}"
node "$artifact_tool" create-manifest \
  --root "$payload" \
  --source-sha "$source_sha" \
  --release-id "$release_id" \
  --security-epoch "${epoch_lines[0]}" \
  --migrations-digest "$migrations_digest" \
  --output "$payload/manifest.json" >/dev/null

tar --create \
  --gzip \
  --file "$output_archive" \
  --directory "$stage_root" \
  --format=pax \
  --sort=name \
  --mtime='@0' \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --hard-dereference \
  --pax-option=delete=atime,delete=ctime \
  payload

[[ -s "$output_archive" && ! -L "$output_archive" ]] || {
  printf 'native API archive was not created\n' >&2
  exit 70
}
archive_sha256="$(sha256sum "$output_archive" | awk '{print $1}')"
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]]
printf '%s  %s\n' "$archive_sha256" "$expected_name" >"$output_sidecar"
chmod 0600 -- "$output_archive" "$output_sidecar"

node "$artifact_tool" verify-archive \
  --archive "$output_archive" \
  --sha256 "$output_sidecar" >/dev/null
verification_root="$(mktemp -d "$temporary_parent/openbmb-api-verify.XXXXXX")"
tar --extract \
  --gzip \
  --file "$output_archive" \
  --directory "$verification_root" \
  --no-same-owner \
  --no-same-permissions
node "$artifact_tool" verify-tree --root "$verification_root/payload" >/dev/null
expanded_bytes="$(du -sb "$verification_root/payload" | awk '{ print $1 }')"
[[ "$expanded_bytes" =~ ^[1-9][0-9]*$ ]] || {
  printf 'could not measure the expanded API payload\n' >&2
  exit 70
}

completed=true
printf 'API_ARCHIVE=%s\n' "$output_archive"
printf 'API_ARCHIVE_SHA256=%s\n' "$archive_sha256"
printf 'API_SIDECAR=%s\n' "$output_sidecar"
printf 'API_EXPANDED_BYTES=%s\n' "$expanded_bytes"
