#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
container=''
output_dir=''
expected_source_sha=''
current_app="${OPENBMB_CURRENT_APP_LINK:-/opt/openbmb/current-app}"
releases_root="${OPENBMB_STACK_RELEASES_ROOT:-/opt/openbmb/releases}"
node_bin="${OPENBMB_NODE_BIN:-/opt/openbmb/runtime/node-v22.19.0-linux-x64/bin/node}"
operation_lock="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"
temporary_root=''
unsafe_path=''

fail() {
  printf 'NATIVE API EXPORT: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$temporary_root" && -d "$temporary_root" ]]; then
    rm -rf -- "$temporary_root"
  fi
}
trap cleanup EXIT

while (($#)); do
  case "$1" in
    --container) container="${2:-}"; shift 2 ;;
    --output-dir) output_dir="${2:-}"; shift 2 ;;
    --expected-source-sha) expected_source_sha="${2:-}"; shift 2 ;;
    *) fail "unknown or incomplete option: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail 'must run as root during bootstrap'
lock_parent="$(dirname -- "$operation_lock")"
[[ -d "$lock_parent" && ! -L "$lock_parent" ]] || fail 'operation lock parent is unsafe'
[[ "$(stat -c %u -- "$lock_parent")" == 0 ]] || fail 'operation lock parent must be root-owned'
lock_parent_mode="$((8#$(stat -c %a -- "$lock_parent")))"
if (( (lock_parent_mode & 8#0022) != 0 && (lock_parent_mode & 8#1000) == 0 )); then
  fail 'writable operation lock parent must have the sticky bit'
fi
if [[ ! -e "$operation_lock" && ! -L "$operation_lock" ]]; then
  (umask 077; set -o noclobber; : >"$operation_lock") 2>/dev/null || true
fi
[[ -f "$operation_lock" && ! -L "$operation_lock" ]] || fail 'operation lock is unsafe'
[[ "$(stat -c %u -- "$operation_lock")" == 0 ]] || fail 'operation lock must be root-owned'
unsafe_path="$(find "$operation_lock" -maxdepth 0 -perm /0022 -print -quit)"
[[ -z "$unsafe_path" ]] || fail 'operation lock must not be writable by group or other users'
exec 9<>"$operation_lock"
if ! flock -n 9; then
  printf 'NATIVE API EXPORT: another production operation owns %s\n' "$operation_lock" >&2
  exit 75
fi
[[ "$container" == openbmb-api ]] || fail 'only the explicit openbmb-api container is accepted'
[[ "$expected_source_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'expected source SHA must be 40 lowercase hex characters'
[[ -n "$output_dir" && "$output_dir" == /* ]] || fail 'output directory must be an absolute path'
[[ -d "$output_dir" && ! -L "$output_dir" ]] || fail 'output directory must already be a real directory'
[[ "$(stat -c %u -- "$output_dir")" == 0 ]] || fail 'output directory must be root-owned'
unsafe_path="$(find "$output_dir" -maxdepth 0 -perm /0022 -print -quit)"
if [[ -n "$unsafe_path" ]]; then
  fail 'output directory must not be writable by group or other users'
fi

container_running="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)"
[[ "$container_running" == true ]] || fail "$container is not running"
image_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container" 2>/dev/null || true)"
[[ "$image_revision" == "$expected_source_sha" ]] || \
  fail "container OCI revision does not match expected source SHA"
container_node_version="$(docker exec "$container" /usr/local/bin/node --version)"
[[ "$container_node_version" == v22.19.0 ]] || fail 'container Node is not v22.19.0'

[[ -L "$current_app" ]] || fail "$current_app must be a symbolic link"
canonical_releases_root="$(readlink -f -- "$releases_root")"
current_app_target="$(readlink -f -- "$current_app")"
[[ "$(dirname -- "$current_app_target")" == "$canonical_releases_root" ]] || \
  fail 'current-app escaped the stack release root'
[[ "$(stat -c %u -- "$current_app_target")" == 0 ]] || fail 'current-app target must be root-owned'
unsafe_path="$(find "$current_app_target" -maxdepth 0 -perm /0022 -print -quit)"
if [[ -n "$unsafe_path" ]]; then
  fail 'current-app target must not be writable by group or other users'
fi
[[ "$(basename -- "$current_app_target")" == "git-${expected_source_sha:0:12}" ]] || \
  fail 'current-app release ID does not match the expected source SHA'
[[ -f "$current_app_target/.openbmb-release-sha" && ! -L "$current_app_target/.openbmb-release-sha" ]] || \
  fail 'current-app source attestation is missing'
[[ "$(tr -d '\r\n' <"$current_app_target/.openbmb-release-sha")" == "$expected_source_sha" ]] || \
  fail 'current-app source attestation does not match the expected SHA'

epoch_file="$current_app_target/infra/production/compatibility/security-epoch"
prisma_root="$current_app_target/apps/server-api/prisma"
[[ -f "$epoch_file" && ! -L "$epoch_file" ]] || fail 'current-app security epoch is missing'
mapfile -t epoch_lines <"$epoch_file"
[[ "${#epoch_lines[@]}" -eq 1 && "${epoch_lines[0]}" =~ ^[1-9][0-9]*$ ]] || \
  fail 'current-app security epoch is invalid'
[[ -d "$prisma_root" && ! -L "$prisma_root" ]] || fail 'current-app Prisma tree is missing'

temporary_root="$(mktemp -d -- "$output_dir/.native-api-export.XXXXXX")"
chmod 0700 -- "$temporary_root"
payload="$temporary_root/payload"
mkdir -p -- "$payload"

# The fixed host runtime is deliberately exported from the already-attested
# image. Executing it on the host catches a missing dynamic-library dependency
# before the old container is touched.
install -d -o root -g root -m 0755 \
  /opt/openbmb/runtime \
  /opt/openbmb/runtime/node-v22.19.0-linux-x64 \
  /opt/openbmb/runtime/node-v22.19.0-linux-x64/bin
docker cp "$container:/usr/local/bin/node" "$temporary_root/node"
install -o root -g root -m 0755 "$temporary_root/node" "$node_bin"
[[ "$($node_bin --version)" == v22.19.0 ]] || fail 'exported host Node failed the v22.19.0 check'

# Dereference workspace links while still inside the trusted current image.
# The resulting payload is later treated as untrusted and must contain only
# ordinary files/directories before its manifest is generated.
docker exec "$container" tar --create --dereference --hard-dereference \
  --file - --directory /workspace \
  node_modules apps/server-api/dist apps/server-api/package.json |
  tar --extract --file - --directory "$payload" --no-same-owner --no-same-permissions
unsafe_path="$(find "$payload" \( -type l -o \( \! -type f -a \! -type d \) \) -print -quit)"
if [[ -n "$unsafe_path" ]]; then
  fail 'container export contains a link or special file'
fi

migrations_digest="$($node_bin "$script_dir/artifact-tool.mjs" tree-digest --root "$prisma_root")"
release_id="git-${expected_source_sha:0:12}"
$node_bin "$script_dir/artifact-tool.mjs" create-manifest \
  --root "$payload" \
  --source-sha "$expected_source_sha" \
  --release-id "$release_id" \
  --security-epoch "${epoch_lines[0]}" \
  --migrations-digest "$migrations_digest" \
  --output "$payload/manifest.json" >/dev/null

artifact_name="openbmb-native-api-${release_id}.tar.gz"
artifact="$output_dir/$artifact_name"
sidecar="$artifact.sha256"
[[ ! -e "$artifact" && ! -L "$artifact" && ! -e "$sidecar" && ! -L "$sidecar" ]] || \
  fail 'refusing to overwrite an existing artifact or sidecar'
tar --create --gzip --file "$temporary_root/$artifact_name" \
  --directory "$temporary_root" \
  --format=pax \
  --hard-dereference \
  --sort=name \
  --mtime='@0' \
  --owner=0 --group=0 --numeric-owner \
  --pax-option=delete=atime,delete=ctime \
  payload
artifact_digest="$(sha256sum "$temporary_root/$artifact_name" | awk '{print $1}')"
printf '%s  %s\n' "$artifact_digest" "$artifact_name" >"$temporary_root/$artifact_name.sha256"
chmod 0640 -- "$temporary_root/$artifact_name" "$temporary_root/$artifact_name.sha256"
chown root:root -- "$temporary_root/$artifact_name" "$temporary_root/$artifact_name.sha256"
mv -- "$temporary_root/$artifact_name" "$artifact"
mv -- "$temporary_root/$artifact_name.sha256" "$sidecar"
printf 'Exported %s with Node v22.19.0 and source %s.\n' "$artifact" "$expected_source_sha"
