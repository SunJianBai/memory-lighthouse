#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
release_entry="$script_dir/openbmb-web-release"
grep -Fq 'lock_file="${OPENBMB_OPERATION_LOCK:-/run/lock/openbmb-operation.lock}"' \
  "$release_entry" || { printf 'production Web lock is not the shared operation lock\n' >&2; exit 1; }
grep -Fq 'OPENBMB_OPERATION_LOCK_FD' "$release_entry" || {
  printf 'Web release cannot authenticate an inherited operation lock\n' >&2
  exit 1
}
grep -Fq 'readonly transition_journal="$state_root/transition.pending"' "$release_entry" || {
  printf 'Web release has no durable transition journal\n' >&2
  exit 1
}
grep -Fq 'write_transition_journal prepared' "$release_entry" || {
  printf 'Web release does not prepare its journal before pointer mutation\n' >&2
  exit 1
}
caddyfile="${OPENBMB_WEB_TEST_CADDYFILE:-$script_dir/../../caddy/Caddyfile}"
[[ -f "$caddyfile" && ! -L "$caddyfile" ]] || {
  printf 'Caddyfile under test is missing or linked: %s\n' "$caddyfile" >&2
  exit 1
}
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-web-release-test.XXXXXX")"
trap 'chmod -R u+w "$test_root" 2>/dev/null || true; rm -rf -- "$test_root"' EXIT

for command in bash python3 tar zstd sha256sum flock realpath; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'test dependency missing: %s\n' "$command" >&2
    exit 1
  }
done
bash -n "$release_entry"

openbmb_root="$test_root/opt/openbmb"
incoming_root="$test_root/incoming"
state_root="$test_root/state"
lock_root="$test_root/lock"
install -d -m 0755 "$test_root/opt" "$test_root/opt/openbmb"
install -d -m 0700 "$incoming_root" "$state_root" "$lock_root"

local_hook="$test_root/local-health"
public_hook="$test_root/public-health"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -Eeuo pipefail' \
  'test -s "$OPENBMB_WEB_ROOT/current-web/site/openBMB/index.html"' \
  'test -s "$OPENBMB_WEB_ROOT/current-web/site/openBMB/admin/index.html"' \
  '[[ ! -e "$OPENBMB_WEB_TEST_ROOT/fail-local-once" ]] || {' \
  '  rm -f -- "$OPENBMB_WEB_TEST_ROOT/fail-local-once"' \
  '  exit 1' \
  '}' > "$local_hook"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -Eeuo pipefail' \
  'test -s "$OPENBMB_WEB_ROOT/current-web/site/openBMB/index.html"' \
  'test -s "$OPENBMB_WEB_ROOT/current-web/site/openBMB/admin/index.html"' \
  '[[ ! -e "$OPENBMB_WEB_TEST_ROOT/fail-public-once" ]] || {' \
  '  rm -f -- "$OPENBMB_WEB_TEST_ROOT/fail-public-once"' \
  '  exit 1' \
  '}' > "$public_hook"
chmod 0700 "$local_hook" "$public_hook"

export OPENBMB_WEB_TEST_MODE=true
export OPENBMB_WEB_ROOT="$openbmb_root"
export OPENBMB_WEB_INCOMING_ROOT="$incoming_root"
export OPENBMB_WEB_STATE_ROOT="$state_root"
export OPENBMB_WEB_LOCK_ROOT="$lock_root"
export OPENBMB_WEB_ARCHIVE_GUARD="$script_dir/archive_guard.py"
export OPENBMB_WEB_LOCAL_HEALTH_HOOK="$local_hook"
export OPENBMB_WEB_PUBLIC_HEALTH_HOOK="$public_hook"
export OPENBMB_WEB_TEST_ROOT="$test_root"
export OPENBMB_WEB_GC_GRACE_SECONDS=0

release_command() {
  bash "$release_entry" "$@"
}

build_archive() {
  local name="$1"
  local marker="$2"
  local payload="$test_root/payload-$name"
  local archive="$incoming_root/$name.tar.zst"
  install -d -m 0755 \
    "$payload/site/openBMB/assets" \
    "$payload/site/openBMB/admin/assets"
  printf '<html>client-%s</html>\n' "$marker" > "$payload/site/openBMB/index.html"
  printf 'asset-%s\n' "$marker" > "$payload/site/openBMB/assets/app.js"
  printf '<html>admin-%s</html>\n' "$marker" > "$payload/site/openBMB/admin/index.html"
  printf 'admin-asset-%s\n' "$marker" > "$payload/site/openBMB/admin/assets/app.js"
  (
    cd "$payload"
    find site -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
    tar -cf - SHA256SUMS site | zstd -q -T1 -o "$archive"
  )
  printf '%s\n' "$archive"
}

archive_sha() {
  local result
  result="$(sha256sum -- "$1")"
  printf '%s\n' "${result%% *}"
}

expect_failure() {
  local expected_status="$1"
  shift
  set +e
  "$@" > "$test_root/expected-failure.out" 2> "$test_root/expected-failure.err"
  local status=$?
  set -e
  [[ "$status" -eq "$expected_status" ]] || {
    printf 'expected status %s, got %s\n' "$expected_status" "$status" >&2
    cat "$test_root/expected-failure.err" >&2
    exit 1
  }
}

# Bootstrap stays inside the temporary root, and lock contention returns EX_TEMPFAIL.
release_command status > "$test_root/initial-status"
grep -Fxq 'current_release=' "$test_root/initial-status"
mkdir "$state_root/staging/promote.A1b2C3" \
  "$openbmb_root/hybrid/web-releases/.incoming.D4e5F6"
printf 'orphan\n' >"$state_root/staging/promote.A1b2C3/file"
printf 'orphan\n' >"$openbmb_root/hybrid/web-releases/.incoming.D4e5F6/file"
touch -d '3 minutes ago' \
  "$state_root/staging/promote.A1b2C3" \
  "$openbmb_root/hybrid/web-releases/.incoming.D4e5F6"
release_command status >/dev/null
[[ ! -e "$state_root/staging/promote.A1b2C3" ]]
[[ ! -e "$openbmb_root/hybrid/web-releases/.incoming.D4e5F6" ]]
ready="$test_root/lock-ready"
flock -x "$lock_root/operation.lock" bash -c 'touch "$1"; sleep 2' _ "$ready" &
lock_holder=$!
for _ in {1..40}; do
  [[ -e "$ready" ]] && break
  sleep 0.05
done
[[ -e "$ready" ]]
expect_failure 75 release_command status
wait "$lock_holder"

commit1=1111111111111111111111111111111111111111
archive1="$(build_archive release-one one)"
sha1="$(archive_sha "$archive1")"
output1="$(release_command promote "$commit1" "$archive1" "$sha1")"
release1="$(printf '%s\n' "$output1" | awk -F= '$1 == "release" { print $2 }')"
[[ "$release1" == "web-$commit1-${sha1:0:16}" ]]
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release1" ]]
[[ "$(stat -c %a "$openbmb_root/current-web/site/openBMB/index.html")" == 444 ]]
[[ "$(stat -c %a "$openbmb_root/current-web/site/openBMB")" == 555 ]]
! find "$openbmb_root/hybrid/web-releases/$release1" -type l -print -quit | grep -q .

# A power-loss-equivalent SIGKILL after current-web switches leaves a durable
# journal. Explicit boot recovery restores both old pointers before clearing it.
crash_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
crash_archive="$(build_archive release-crash crash)"
crash_sha="$(archive_sha "$crash_archive")"
crash_release="web-$crash_commit-${crash_sha:0:16}"
set +e
OPENBMB_WEB_TEST_CRASH_PHASE=current-switched \
  release_command promote "$crash_commit" "$crash_archive" "$crash_sha" \
  >"$test_root/crash.out" 2>"$test_root/crash.err"
crash_status=$?
set -e
[[ "$crash_status" -eq 137 ]]
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$crash_release" ]]
[[ ! -e "$openbmb_root/previous-web" && ! -L "$openbmb_root/previous-web" ]]
[[ -f "$state_root/transition.pending" && ! -L "$state_root/transition.pending" ]]
grep -Fxq 'phase=current-switched' "$state_root/transition.pending"
grep -Fxq "old_current=$release1" "$state_root/transition.pending"
grep -Fxq "target_release=$crash_release" "$state_root/transition.pending"
[[ "$(stat -c %a "$state_root/transition.pending")" == 600 ]]
# Boot recovery runs with ProtectHome=yes, so it must not depend on the upload
# directory being visible after the immutable target and journal already exist.
mv -- "$incoming_root" "$test_root/incoming-hidden"
recovery_output="$(release_command recover)"
mv -- "$test_root/incoming-hidden" "$incoming_root"
grep -Fxq 'recovery=rolled-back' <<<"$recovery_output"
grep -Fxq "release=$release1" <<<"$recovery_output"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release1" ]]
[[ ! -e "$openbmb_root/previous-web" && ! -L "$openbmb_root/previous-web" ]]
[[ ! -e "$state_root/transition.pending" && ! -L "$state_root/transition.pending" ]]

# Once the exact promotion record is durable, recovery completes that commit
# instead of rolling back an already successful, health-checked transition.
set +e
OPENBMB_WEB_TEST_CRASH_PHASE=record-written \
  release_command promote "$crash_commit" "$crash_archive" "$crash_sha" \
  >"$test_root/commit-crash.out" 2>"$test_root/commit-crash.err"
commit_crash_status=$?
set -e
[[ "$commit_crash_status" -eq 137 ]]
grep -Fxq 'phase=record-written' "$state_root/transition.pending"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$crash_release" ]]
[[ "$(readlink "$openbmb_root/previous-web")" == "hybrid/web-releases/$release1" ]]
commit_recovery_output="$(release_command recover)"
grep -Fxq 'recovery=committed' <<<"$commit_recovery_output"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$crash_release" ]]
[[ "$(readlink "$openbmb_root/previous-web")" == "hybrid/web-releases/$release1" ]]
[[ ! -e "$state_root/transition.pending" && ! -L "$state_root/transition.pending" ]]
release_command revert "$release1" >/dev/null
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release1" ]]

# The copied archive digest is authoritative; the upload path itself is untrusted.
bad_sha_suffix=0
[[ "${sha1: -1}" == 0 ]] && bad_sha_suffix=1
expect_failure 65 release_command promote "$commit1" "$archive1" "${sha1:0:63}$bad_sha_suffix"
mkdir -m 0700 "$incoming_root/nested"
cp "$archive1" "$incoming_root/nested/release.tar.zst"
expect_failure 64 release_command promote "$commit1" "$incoming_root/nested/release.tar.zst" "$sha1"
ln -s "$archive1" "$incoming_root/linked.tar.zst"
expect_failure 65 release_command promote "$commit1" "$incoming_root/linked.tar.zst" "$sha1"

# A tar symlink is rejected before extraction.
symlink_payload="$test_root/symlink-payload"
install -d -m 0755 "$symlink_payload/site/openBMB/admin"
printf x > "$symlink_payload/site/openBMB/index.html"
printf y > "$symlink_payload/site/openBMB/admin/index.html"
ln -s /etc/passwd "$symlink_payload/site/openBMB/escape"
(
  cd "$symlink_payload"
  find site -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
  tar -cf - SHA256SUMS site | zstd -q -T1 -o "$incoming_root/symlink.tar.zst"
)
symlink_sha="$(archive_sha "$incoming_root/symlink.tar.zst")"
expect_failure 65 release_command promote \
  2222222222222222222222222222222222222222 \
  "$incoming_root/symlink.tar.zst" "$symlink_sha"

# A parent traversal name is rejected even though no system tar extraction is used.
python3 - "$test_root/traversal.tar" <<'PY'
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], "w") as archive:
    member = tarfile.TarInfo("../escape")
    member.size = 1
    member.mode = 0o644
    archive.addfile(member, io.BytesIO(b"x"))
PY
zstd -q -T1 "$test_root/traversal.tar" -o "$incoming_root/traversal.tar.zst"
traversal_sha="$(archive_sha "$incoming_root/traversal.tar.zst")"
expect_failure 65 release_command promote \
  2222222222222222222222222222222222222222 \
  "$incoming_root/traversal.tar.zst" "$traversal_sha"

# A complete file list is mandatory; adding a file after manifest creation fails.
manifest_payload="$test_root/manifest-payload"
install -d -m 0755 "$manifest_payload/site/openBMB/admin"
printf x > "$manifest_payload/site/openBMB/index.html"
printf y > "$manifest_payload/site/openBMB/admin/index.html"
(
  cd "$manifest_payload"
  find site -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
  printf unlisted > site/openBMB/unlisted.js
  tar -cf - SHA256SUMS site | zstd -q -T1 -o "$incoming_root/unlisted.tar.zst"
)
unlisted_sha="$(archive_sha "$incoming_root/unlisted.tar.zst")"
expect_failure 65 release_command promote \
  2222222222222222222222222222222222222222 \
  "$incoming_root/unlisted.tar.zst" "$unlisted_sha"

# Public health failure automatically restores the old current pointer.
commit2=2222222222222222222222222222222222222222
archive2="$(build_archive release-two two)"
sha2="$(archive_sha "$archive2")"
touch "$test_root/fail-public-once"
expect_failure 1 release_command promote "$commit2" "$archive2" "$sha2"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release1" ]]

output2="$(release_command promote "$commit2" "$archive2" "$sha2")"
release2="$(printf '%s\n' "$output2" | awk -F= '$1 == "release" { print $2 }')"
promotion2="$(printf '%s\n' "$output2" | awk -F= '$1 == "promotion_id" { print $2 }')"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release2" ]]
[[ "$(readlink "$openbmb_root/previous-web")" == "hybrid/web-releases/$release1" ]]

# A promotion ID means "undo that promotion"; an exact retained release also works.
revert_output="$(release_command revert "$promotion2")"
grep -Fxq "release=$release1" <<< "$revert_output"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release1" ]]
[[ "$(readlink "$openbmb_root/previous-web")" == "hybrid/web-releases/$release2" ]]
release_command revert "$release2" > "$test_root/revert-by-release"
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release2" ]]

# Garbage collection is two-phase: only an unreferenced release with an existing
# candidate marker can be removed.  Current and one-step rollback stay pinned.
commit3=3333333333333333333333333333333333333333
archive3="$(build_archive release-three three)"
sha3="$(archive_sha "$archive3")"
output3="$(release_command promote "$commit3" "$archive3" "$sha3")"
release3="$(printf '%s\n' "$output3" | awk -F= '$1 == "release" { print $2 }')"
[[ -f "$state_root/gc-candidates/$release1" ]]

commit4=4444444444444444444444444444444444444444
archive4="$(build_archive release-four four)"
sha4="$(archive_sha "$archive4")"
output4="$(release_command promote "$commit4" "$archive4" "$sha4")"
release4="$(printf '%s\n' "$output4" | awk -F= '$1 == "release" { print $2 }')"
[[ ! -e "$openbmb_root/hybrid/web-releases/$release1" ]]
[[ -d "$openbmb_root/hybrid/web-releases/$release4" ]]
[[ -d "$openbmb_root/hybrid/web-releases/$release3" ]]
[[ "$(readlink "$openbmb_root/current-web")" == "hybrid/web-releases/$release4" ]]
[[ "$(readlink "$openbmb_root/previous-web")" == "hybrid/web-releases/$release3" ]]

status_output="$(release_command status)"
grep -Fxq "current_release=$release4" <<< "$status_output"
grep -Fxq "previous_release=$release3" <<< "$status_output"

# Caddy keeps every sensitive proxy ahead of both SPA handlers, and both handlers
# use the fixed current-web root instead of a Web container upstream.
line_of() { grep -nF -m 1 -- "$2" "$1" | cut -d: -f1; }
livekit_line="$(line_of "$caddyfile" '@livekitSignal path')"
storage_line="$(line_of "$caddyfile" '@objectStorage path')"
api_line="$(line_of "$caddyfile" '@openbmbApi path')"
admin_line="$(line_of "$caddyfile" '@openbmbAdmin path')"
client_line="$(line_of "$caddyfile" '@openbmbClient path')"
(( livekit_line < storage_line && storage_line < api_line && api_line < admin_line && admin_line < client_line ))
[[ "$(grep -Fc 'root * /opt/openbmb/current-web/site' "$caddyfile")" -eq 2 ]]
grep -Fq '{$OPENBMB_API_STABLE_BIND:http://127.0.0.1:13100} {' "$caddyfile"
grep -Fq 'reverse_proxy {$OPENBMB_API_UPSTREAM:127.0.0.1:13101}' "$caddyfile"
! grep -Fq 'OPENBMB_CLIENT_UPSTREAM' "$caddyfile"
! grep -Fq 'OPENBMB_ADMIN_UPSTREAM' "$caddyfile"

if command -v caddy >/dev/null 2>&1; then
  ACME_EMAIL="${ACME_EMAIL:-test@example.invalid}" \
    CADDY_ACCESS_LOG="$test_root/caddy-access.log" \
    caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null
fi

printf 'Hybrid Web release tests: OK\n'
