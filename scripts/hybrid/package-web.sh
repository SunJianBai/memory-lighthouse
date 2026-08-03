#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

usage() {
  cat >&2 <<'EOF'
usage: scripts/hybrid/package-web.sh <commit40> <absolute-output.tar.zst>

Packages the already-built client and admin web applications. The archive root
contains only SHA256SUMS and site/, with client files under site/openBMB and
admin files under site/openBMB/admin.
EOF
}

[[ "$#" -eq 2 ]] || {
  usage
  exit 64
}

source_sha="$1"
output_archive="$2"

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'commit must be exactly 40 lowercase hexadecimal characters\n' >&2
  exit 64
}
[[ "$output_archive" == /* && "$output_archive" == *.tar.zst ]] || {
  printf 'output archive must be an absolute .tar.zst path\n' >&2
  exit 64
}
[[ ! -e "$output_archive" && ! -L "$output_archive" ]] || {
  printf 'refusing to overwrite output archive: %s\n' "$output_archive" >&2
  exit 73
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "$script_dir/../.." && pwd -P)"
actual_root="$(git -C "$project_root" rev-parse --show-toplevel)"
actual_root="$(cd -- "$actual_root" && pwd -P)"
[[ "$actual_root" == "$project_root" ]] || {
  printf 'script is not running from the expected repository root\n' >&2
  exit 65
}

actual_sha="$(git -C "$project_root" rev-parse HEAD)"
[[ "$actual_sha" == "$source_sha" ]] || {
  printf 'HEAD mismatch: expected %s, got %s\n' "$source_sha" "$actual_sha" >&2
  exit 65
}
[[ -z "$(git -C "$project_root" status --porcelain=v1 --untracked-files=all)" ]] || {
  printf 'refusing to package a dirty worktree\n' >&2
  exit 65
}

for command_name in awk cp du find mktemp sha256sum sort tar xargs zstd; do
  command -v "$command_name" >/dev/null || {
    printf 'required command is missing: %s\n' "$command_name" >&2
    exit 69
  }
done

client_dist="$project_root/apps/client-web/dist"
admin_dist="$project_root/apps/admin-web/dist"
[[ -f "$client_dist/index.html" && -f "$admin_dist/index.html" ]] || {
  printf 'both web workspaces must be built before packaging\n' >&2
  exit 66
}

evidence_parent="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
[[ -d "$evidence_parent" && ! -L "$evidence_parent" ]] || {
  printf 'invalid temporary directory: %s\n' "$evidence_parent" >&2
  exit 73
}
stage_root="$(mktemp -d "$evidence_parent/openbmb-web-stage.XXXXXX")"
printf 'Packaging evidence directory: %s\n' "$stage_root"

site_root="$stage_root/site/openBMB"
[[ ! -e "$client_dist/admin" && ! -L "$client_dist/admin" ]] || {
  printf 'client build must not contain the reserved top-level admin path\n' >&2
  exit 65
}
mkdir -p -- "$site_root"
cp -a -- "$client_dist/." "$site_root/"
mkdir -p -- "$site_root/admin"
cp -a -- "$admin_dist/." "$site_root/admin/"

[[ -f "$site_root/index.html" && -f "$site_root/admin/index.html" ]] || {
  printf 'staged archive is missing one or both entry points\n' >&2
  exit 66
}
[[ -z "$(find "$stage_root/site" -type l -print -quit)" ]] || {
  printf 'symbolic links are not allowed in the web artifact\n' >&2
  exit 65
}
[[ -z "$(find "$stage_root/site" ! -type f ! -type d -print -quit)" ]] || {
  printf 'only regular files and directories are allowed in the web artifact\n' >&2
  exit 65
}
while IFS= read -r -d '' artifact_path; do
  [[ "$artifact_path" =~ ^site/openBMB(/[A-Za-z0-9._@+-]+)*$ ]] || {
    printf 'artifact path uses unsupported characters: %s\n' "$artifact_path" >&2
    exit 65
  }
  (( ${#artifact_path} <= 512 )) || {
    printf 'artifact path is too long: %s\n' "$artifact_path" >&2
    exit 65
  }
done < <(cd -- "$stage_root" && find site -mindepth 1 -print0)

(
  cd -- "$stage_root"
  find site -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum --text > SHA256SUMS
)
[[ -s "$stage_root/SHA256SUMS" ]] || {
  printf 'generated SHA256SUMS is empty\n' >&2
  exit 70
}

output_parent="$(dirname -- "$output_archive")"
[[ -d "$output_parent" && ! -L "$output_parent" ]] || {
  printf 'output parent must be an existing non-symlink directory: %s\n' \
    "$output_parent" >&2
  exit 73
}

(
  cd -- "$stage_root"
  tar --create \
    --file "$output_archive" \
    --format=ustar \
    --sort=name \
    --mtime='@0' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --mode='u=rwX,go=rX' \
    --use-compress-program='zstd -19 -T0' \
    SHA256SUMS site
)

[[ -s "$output_archive" && ! -L "$output_archive" ]] || {
  printf 'archive was not created as a regular non-empty file\n' >&2
  exit 70
}

verification_root="$(mktemp -d "$evidence_parent/openbmb-web-verify.XXXXXX")"
tar --extract --file "$output_archive" --directory "$verification_root" --zstd
[[ "$(find "$verification_root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == $'SHA256SUMS\nsite' ]]
(
  cd -- "$verification_root"
  sha256sum --check --strict SHA256SUMS
)

archive_sha256="$(sha256sum "$output_archive" | awk '{ print $1 }')"
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]]
expanded_bytes="$(du -sb "$stage_root/site" | awk '{ print $1 }')"
[[ "$expanded_bytes" =~ ^[1-9][0-9]*$ ]] || {
  printf 'could not measure the expanded Web payload\n' >&2
  exit 70
}
printf 'WEB_ARCHIVE=%s\n' "$output_archive"
printf 'WEB_ARCHIVE_SHA256=%s\n' "$archive_sha256"
printf 'WEB_EXPANDED_BYTES=%s\n' "$expanded_bytes"
