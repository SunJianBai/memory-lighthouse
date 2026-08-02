#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-image-import-test.XXXXXX")"
case "$test_root" in
  "${TMPDIR:-/tmp}"/openbmb-image-import-test.*) ;;
  *) printf 'unsafe image import test directory\n' >&2; exit 1 ;;
esac
cleanup() {
  rm -rf -- "$test_root"
}
trap cleanup EXIT

fake_bin="$test_root/bin"
fake_state="$test_root/docker-state"
fake_docker_root="$test_root/docker-root"
test_home="$test_root/home"
transfer_root="$test_home/.openbmb-transfer/direct-v2/sessions/100-1"
cache_release_root="$test_home/.openbmb-transfer/direct-v2/cache/git-0123456789ab"
install -d -m 0700 "$fake_bin" "$fake_state/refs" "$fake_docker_root" \
  "$transfer_root" "$cache_release_root"
cp "$script_dir/import-release-image.sh" "$script_dir/release-image-set.sh" "$transfer_root/"
chmod 0700 "$transfer_root/import-release-image.sh"

cat > "$fake_bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${FAKE_DOCKER_STATE:?}"
key_for() {
  printf '%s' "$1" | sha256sum | awk '{ print $1 }'
}
record_ref() {
  local ref="$1"
  local image_id="$2"
  local revision="${3:-}"
  printf '%s %s\n' "$image_id" "$revision" > "$state/refs/$(key_for "$ref")"
}
read_ref() {
  local ref="$1"
  local path="$state/refs/$(key_for "$ref")"
  [[ -f "$path" ]] || exit 1
  cat "$path"
}
case "${1:-} ${2:-}" in
  'image inspect')
    [[ "$3" == --format && $# -eq 5 ]]
    read -r image_id revision < <(read_ref "$5")
    case "$4" in
      '{{.Id}}') printf '%s\n' "$image_id" ;;
      *org.opencontainers.image.revision*) printf '%s\n' "$revision" ;;
      *) exit 1 ;;
    esac
    ;;
  'info --format')
    printf '%s\n' "${FAKE_DOCKER_ROOT:?}"
    ;;
  'tag '*)
    [[ $# -eq 3 ]]
    read -r image_id revision < <(read_ref "$2")
    record_ref "$3" "$image_id" "$revision"
    ;;
  'load '*)
    tag=''
    image_id=''
    revision=''
    while IFS='=' read -r key value; do
      case "$key" in
        TAG) tag="$value" ;;
        ID) image_id="$value" ;;
        REV) revision="$value" ;;
      esac
    done
    [[ "$tag" == openbmb-*:* ]]
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
    record_ref "$image_id" "$image_id" "$revision"
    record_ref "$tag" "$image_id" "$revision"
    ;;
  *)
    printf 'unexpected fake docker call: %q ' "$@" >&2
    printf '\n' >&2
    exit 1
    ;;
esac
FAKE_DOCKER

cat > "$fake_bin/df" <<'FAKE_DF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/fake 20000000 1 %s 1%% /fake\n' "${FAKE_DF_FREE_KIB:-9000000}"
FAKE_DF
chmod 0700 "$fake_bin/docker" "$fake_bin/df"

export PATH="$fake_bin:$PATH"
export FAKE_DOCKER_STATE="$fake_state"
export FAKE_DOCKER_ROOT="$fake_docker_root"
export OPENBMB_OPERATION_LOCK_HELD=true
export HOME="$test_home"

source_sha=0123456789abcdef0123456789abcdef01234567
release_id=git-0123456789ab
expected_id="sha256:$(printf 'a%.0s' {1..64})"

key_for() {
  printf '%s' "$1" | sha256sum | awk '{ print $1 }'
}
seed_ref() {
  local ref="$1"
  local image_id="$2"
  local revision="${3:-}"
  printf '%s %s\n' "$image_id" "$revision" > "$fake_state/refs/$(key_for "$ref")"
}
reset_state() {
  rm -rf -- "$fake_state"
  install -d -m 0700 "$fake_state/refs"
}
run_importer() {
  bash "$transfer_root/import-release-image.sh" "$@"
}
expect_failure() {
  if "$@" >"$test_root/expected-failure.out" 2>"$test_root/expected-failure.err"; then
    printf 'command unexpectedly succeeded: %q ' "$@" >&2
    printf '\n' >&2
    exit 1
  fi
}
prepare_archive() {
  local case_name="$1"
  local component="$2"
  local tag="$3"
  local image_id="$4"
  local revision="$5"
  local build_dir="$test_root/build-$case_name"
  rm -rf -- "$build_dir"
  install -d -m 0700 "$build_dir"
  printf 'TAG=%s\nID=%s\nREV=%s\n' "$tag" "$image_id" "$revision" > "$build_dir/payload"
  TEST_RAW_BYTES="$(stat -c %s "$build_dir/payload")"
  gzip -1 -n -c "$build_dir/payload" > "$build_dir/archive.gz"
  TEST_COMPRESSED_BYTES="$(stat -c %s "$build_dir/archive.gz")"
  TEST_ARCHIVE_SHA="$(sha256sum "$build_dir/archive.gz" | awk '{ print $1 }')"
  TEST_ARCHIVE_DIR="$cache_release_root/$component/$TEST_ARCHIVE_SHA"
  install -d -m 0700 "$TEST_ARCHIVE_DIR"
  cp "$build_dir/archive.gz" "$TEST_ARCHIVE_DIR/part-000000"
  local chunk_sha
  local chunk_bytes
  chunk_sha="$(sha256sum "$TEST_ARCHIVE_DIR/part-000000" | awk '{ print $1 }')"
  chunk_bytes="$(stat -c %s "$TEST_ARCHIVE_DIR/part-000000")"
  printf '%s %s part-000000\n' "$chunk_sha" "$chunk_bytes" > "$TEST_ARCHIVE_DIR/chunks.manifest"
  TEST_MANIFEST_SHA="$(sha256sum "$TEST_ARCHIVE_DIR/chunks.manifest" | awk '{ print $1 }')"
}
import_prepared() {
  local component="$1"
  local image_id="$2"
  run_importer import "$release_id" "$source_sha" "$component" "$image_id" \
    "$TEST_ARCHIVE_SHA" "$TEST_RAW_BYTES" "$TEST_COMPRESSED_BYTES" \
    chunks.manifest "$TEST_MANIFEST_SHA"
}

# An exact content-addressed image is retagged without an archive transfer.
reset_state
seed_ref "$expected_id" "$expected_id" "$source_sha"
[[ "$(run_importer probe "$release_id" "$source_sha" api "$expected_id")" == present ]]
[[ "$(cut -d' ' -f1 "$fake_state/refs/$(key_for "openbmb-api:$release_id")")" == "$expected_id" ]]

# A valid archive is imported, attested, and only its exact archive directory is removed.
reset_state
prepare_archive valid api "openbmb-api:$release_id" "$expected_id" "$source_sha"
keep_marker="$cache_release_root/api/keep.marker"
printf 'keep\n' > "$keep_marker"
[[ "$(import_prepared api "$expected_id")" == imported ]]
[[ ! -e "$TEST_ARCHIVE_DIR" && -f "$keep_marker" ]]
rm -f -- "$keep_marker"

# Corrupt, missing, duplicate, or whole-archive-mismatched chunks are rejected before docker load.
reset_state
prepare_archive corrupt api "openbmb-api:$release_id" "$expected_id" "$source_sha"
printf 'corrupt\n' >> "$TEST_ARCHIVE_DIR/part-000000"
expect_failure import_prepared api "$expected_id"

reset_state
prepare_archive missing api "openbmb-api:$release_id" "$expected_id" "$source_sha"
printf '%064d 1 part-000001\n' 0 >> "$TEST_ARCHIVE_DIR/chunks.manifest"
TEST_MANIFEST_SHA="$(sha256sum "$TEST_ARCHIVE_DIR/chunks.manifest" | awk '{ print $1 }')"
TEST_COMPRESSED_BYTES=$((TEST_COMPRESSED_BYTES + 1))
expect_failure import_prepared api "$expected_id"

reset_state
prepare_archive duplicate api "openbmb-api:$release_id" "$expected_id" "$source_sha"
head -n 1 "$TEST_ARCHIVE_DIR/chunks.manifest" >> "$TEST_ARCHIVE_DIR/chunks.manifest"
TEST_MANIFEST_SHA="$(sha256sum "$TEST_ARCHIVE_DIR/chunks.manifest" | awk '{ print $1 }')"
TEST_COMPRESSED_BYTES=$((TEST_COMPRESSED_BYTES * 2))
expect_failure import_prepared api "$expected_id"

reset_state
prepare_archive archive-digest api "openbmb-api:$release_id" "$expected_id" "$source_sha"
wrong_archive_sha="$(printf 'f%.0s' {1..64})"
wrong_archive_dir="$cache_release_root/api/$wrong_archive_sha"
mv -- "$TEST_ARCHIVE_DIR" "$wrong_archive_dir"
TEST_ARCHIVE_SHA="$wrong_archive_sha"
TEST_ARCHIVE_DIR="$wrong_archive_dir"
expect_failure import_prepared api "$expected_id"

# The loaded ID, application OCI revision, and 4 GiB residual-space gate are fail-closed.
reset_state
wrong_id="sha256:$(printf 'b%.0s' {1..64})"
prepare_archive wrong-id api "openbmb-api:$release_id" "$wrong_id" "$source_sha"
expect_failure import_prepared api "$expected_id"

reset_state
prepare_archive wrong-revision api "openbmb-api:$release_id" "$expected_id" deadbeef
expect_failure import_prepared api "$expected_id"

reset_state
prepare_archive low-disk api "openbmb-api:$release_id" "$expected_id" "$source_sha"
export FAKE_DF_FREE_KIB=4194304
expect_failure import_prepared api "$expected_id"
unset FAKE_DF_FREE_KIB

# Final publication is atomic: all ten exact IDs must attest before the manifest appears.
reset_state
# shellcheck source=release-image-set.sh
source "$transfer_root/release-image-set.sh"
openbmb_load_release_image_set "$release_id"
expected_manifest_name="expected-images-$source_sha-100-1.txt"
host_manifest_name="openbmb-images-$source_sha-100-1.txt"
expected_manifest="$transfer_root/$expected_manifest_name"
install -m 0600 /dev/null "$expected_manifest"
for index in "${!OPENBMB_REQUIRED_IMAGES[@]}"; do
  printf -v image_hex '%064x' "$((index + 1))"
  image_id="sha256:$image_hex"
  revision=''
  case "${OPENBMB_DELIVERY_COMPONENTS[$index]}" in
    api|migrator|client-web|admin-web) revision="$source_sha" ;;
  esac
  seed_ref "$image_id" "$image_id" "$revision"
  printf '%s %s\n' "${OPENBMB_REQUIRED_IMAGES[$index]}" "$image_id" >> "$expected_manifest"
done
expected_manifest_sha="$(sha256sum "$expected_manifest" | awk '{ print $1 }')"
[[ "$(run_importer finalize "$release_id" "$source_sha" "$expected_manifest_name" "$expected_manifest_sha" "$host_manifest_name")" == finalized ]]
cmp --silent "$expected_manifest" "$transfer_root/$host_manifest_name"
# A retry may reuse the file only after repeating all Docker ID/revision attestations.
[[ "$(run_importer finalize "$release_id" "$source_sha" "$expected_manifest_name" "$expected_manifest_sha" "$host_manifest_name")" == finalized ]]
first_id="$(awk 'NR == 1 { print $2 }' "$expected_manifest")"
rm -f -- "$fake_state/refs/$(key_for "$first_id")"
expect_failure run_importer finalize "$release_id" "$source_sha" \
  "$expected_manifest_name" "$expected_manifest_sha" "$host_manifest_name"
seed_ref "$first_id" "$first_id" "$source_sha"

# A different attempt is isolated in its own session; partial failure never publishes a host manifest.
bad_transfer_root="$test_home/.openbmb-transfer/direct-v2/sessions/100-2"
install -d -m 0700 "$bad_transfer_root"
cp "$script_dir/import-release-image.sh" "$script_dir/release-image-set.sh" "$bad_transfer_root/"
chmod 0700 "$bad_transfer_root/import-release-image.sh"
bad_expected_name="expected-images-$source_sha-100-2.txt"
bad_host_name="openbmb-images-$source_sha-100-2.txt"
bad_expected="$bad_transfer_root/$bad_expected_name"
cp "$expected_manifest" "$bad_expected"
bad_id="sha256:$(printf 'e%.0s' {1..64})"
sed -i "1s#sha256:[0-9a-f]\{64\}#$bad_id#" "$bad_expected"
bad_expected_sha="$(sha256sum "$bad_expected" | awk '{ print $1 }')"
expect_failure bash "$bad_transfer_root/import-release-image.sh" finalize "$release_id" "$source_sha" \
  "$bad_expected_name" "$bad_expected_sha" "$bad_host_name"
[[ ! -e "$bad_transfer_root/$bad_host_name" ]]
! find "$bad_transfer_root" -maxdepth 1 -name ".$bad_host_name.tmp.*" -print -quit | grep -q .

# Cleanup reattests all ten images, removes only whitelisted cache files, and leaves sessions intact.
stale_archive="$cache_release_root/api/$(printf 'c%.0s' {1..64})"
install -d -m 0700 "$stale_archive"
printf 'stale\n' > "$stale_archive/part-000000.partial-99-1"
[[ "$(run_importer cleanup "$release_id" "$source_sha" "$expected_manifest_name" "$expected_manifest_sha")" == cleaned ]]
[[ ! -e "$cache_release_root" && -d "$transfer_root" && -d "$bad_transfer_root" ]]

printf 'Release image import fixtures: OK\n'
