# Hybrid Web release module

This Module keeps the production Interface deliberately small while hiding
archive validation, immutable releases, atomic pointer changes, health recovery,
and conservative garbage collection in one implementation.

## Stable server Interface

Install the files once with:

```bash
sudo bash infra/production/hybrid/web/install-web-release.sh
```

The stable entry is then:

```text
/usr/local/sbin/openbmb-web-release promote <commit40> <archive-abs-path> <sha256>
/usr/local/sbin/openbmb-web-release revert <promotion-id-or-release>
/usr/local/sbin/openbmb-web-release recover
/usr/local/sbin/openbmb-web-release status
```

`promote` accepts an archive only when it is a direct regular file (not a link)
under `/home/ubuntu/.openbmb-web-incoming`. The upload directory is untrusted.
The implementation copies the archive to a root-only staging directory before
checking the caller-supplied SHA256, inspecting it, and extracting it. This closes
the upload-check/extract race.

The command prints machine-readable `key=value` lines. A successful change has a
`promotion_id`; passing that ID to `revert` restores the release that was current
immediately before that promotion. Passing an exact retained `web-...` release
name switches directly to it.

## Archive contract

The zstd-compressed tar has exactly this logical shape:

```text
SHA256SUMS
site/
  openBMB/
    index.html
    ...client files...
    admin/
      index.html
      ...admin files...
```

No leading `./` is allowed. `SHA256SUMS` has one GNU `sha256sum` text-mode line
for every regular file under `site/` and no other line. Entries therefore look
like:

```text
<64 lowercase hex><two spaces>site/openBMB/assets/index-AbCd1234.js
```

Paths use a conservative ASCII set. Links, hard links, devices, FIFOs, sparse
members, duplicate names, traversal, absolute paths, writable/special modes,
unlisted files, and missing SPA entrypoints are rejected. The default caps are
512 MiB compressed, 1 GiB expanded, and 100,000 archive members.

A deterministic client/CI packaging adapter can use:

```bash
(
  cd web-package-root
  find site -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
  tar -cf - SHA256SUMS site | zstd -q -T0 -o openbmb-web-<commit40>.tar.zst
)
sha256sum openbmb-web-<commit40>.tar.zst
```

The packaging adapter must place the client build at `site/openBMB/` and the
admin build at `site/openBMB/admin/`; it must not include its temporary build
directory or a parent `.` member.

## Files, ownership, and runtime state

The installer establishes:

| Path | Owner | Mode / purpose |
|---|---|---|
| `/usr/local/sbin/openbmb-web-release` | `root:root` | `0755`, stable Interface |
| `/usr/local/libexec/openbmb-web-release/archive_guard.py` | `root:root` | `0755`, private implementation |
| `/opt/openbmb` | `root:openbmb` | `0751`, preserves Docker fallback ownership while allowing Caddy traversal only |
| `/opt/openbmb/hybrid/web-releases` | `root:root` | `0755`, immutable release directories |
| `/opt/openbmb/current-web` | `root:root` | atomic symlink used by Caddy |
| `/opt/openbmb/previous-web` | `root:root` | one-step rollback symlink |
| `/var/lib/openbmb/web-release/{staging,promotions,gc-candidates}` | `root:root` | `0700`, private state |
| `/var/lib/openbmb/web-release/transition.pending` | `root:root` | `0600`, fsynced in-flight transition journal |
| `/run/lock/openbmb-operation.lock` | `root:root` | shared production operation lock; never truncated |
| `/home/ubuntu/.openbmb-web-incoming` | `ubuntu:ubuntu` | `0700`, untrusted uploads |

Published files are `root:root 0444` and directories are `root:root 0555`, so the
`caddy` account can read but cannot change them. The Module refuses a linked or
group/world-writable implementation, state directory, pointer, release, or lock.
It requires Bash, GNU coreutils/findutils, util-linux `flock`, Python 3, zstd,
curl, and `runuser`, plus the existing `ubuntu` and `caddy` accounts.

Before changing `current-web`, the module records the operation, old current and
previous pointers, target release, artifact identity, promotion ID, and phase in
`transition.pending`, then fsyncs both the file and its directory. Pointer and
phase changes are also fsynced. The journal is cleared only after the new release
passes loopback and public client/admin probes, `previous-web` is durable, and the
matching promotion record is durable.

`recover` runs under the same global lock. If a crash happened before that
promotion record became durable, it restores both old pointers; if the exact
record is already durable, it verifies the committed pointers and retains the
new release. A malformed journal or conflicting record fails closed and remains
for investigation. `promote`, `revert`, and `status` perform this recovery first,
and `openbmb-hybrid-recovery.service` invokes it during boot before Caddy starts.
This boot path deliberately does not require access to the protected upload home.

Any ordinary health failure or handled signal uses the same durable recovery and
probes the restored release again. Promote, revert, API deploy, runtime-mode
switching, and the full Docker release therefore serialize on one lock. A
delivery wrapper may pass the already-open descriptor only through the
authenticated `OPENBMB_OPERATION_LOCK_*` contract; the module verifies the
descriptor inode and lock before trusting it.

Garbage collection is intentionally two-phase. A release must be absent from
both `current-web` and `previous-web`, receive an exact root-only candidate
marker, and remain unreachable for the grace period before a later operation can
delete that exact directory. A safety-check failure skips cleanup rather than
weakening the retention rule.

Every locked operation also removes at most eight root-owned, direct-child
`promote.XXXXXX` or `.incoming.XXXXXX` scratch directories older than the same
24-hour grace period. It never follows links or scans outside the two fixed
module roots, so a killed promotion cannot consume disk indefinitely.

## Verification

The test creates every release, archive, pointer, lock, health hook, and malicious
fixture under one `mktemp` directory; it never uses `/opt`, `/var/lib`, `/run`, or
the production upload directory:

```bash
bash infra/production/hybrid/web/test-web-release.sh
```

It covers valid promotion, lock contention, upload path confinement, SHA mismatch,
tar traversal/link rejection, manifest completeness, immutable permissions,
automatic health rollback, `SIGKILL` recovery both before and after the durable
promotion-record commit boundary, both revert forms, two-phase cleanup, route
order, and Caddy validation when the `caddy` binary is installed.
