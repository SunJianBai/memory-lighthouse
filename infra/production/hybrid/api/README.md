# Native NestJS API delivery

This module keeps MySQL, Redis, MinIO, ClamAV and LiveKit in the existing
Docker stack while running the NestJS API under a dedicated `openbmb` system
user. It is intentionally a fast **application-only** path. Any Prisma
migration-set or security-epoch change exits `78` with
`SLOW_PATH_REQUIRED`; the existing full release state machine must handle that
release.

## Stable paths and ports

- fixed runtime: `/opt/openbmb/runtime/node-v22.19.0-linux-x64/bin/node`
- immutable API releases: `/opt/openbmb/hybrid/api-releases/git-<12-sha>`
- blue/green links: `/opt/openbmb/hybrid/api-slots/{blue,green}`
- native runtime pointer: `/opt/openbmb/current-api`
- previous native runtime pointer: `/opt/openbmb/previous-api`
- compatibility anchor (read-only): `/opt/openbmb/current-app`
- blue: `127.0.0.1:13101`; green: `127.0.0.1:13102`
- interrupted-operation journal: `/opt/openbmb/hybrid/native-api.pending`
- shared operation lock: `/run/lock/openbmb-operation.lock`

`current-app` is never changed by this module. The Docker backup, rollback and
security-epoch state machine rely on it remaining a direct child of
`/opt/openbmb/releases`.

## Bootstrap and first artifact

The current container export is a one-time bridge; it refuses a stopped
container, an unexpected container name, an OCI revision mismatch, or a
`current-app` link outside the stack release root. It also exports
`/usr/local/bin/node` from the attested image and proves that the host can run
it as exactly Node `22.19.0`.

```bash
sudo install -d -o root -g root -m 0750 /var/lib/openbmb/bootstrap
sudo bash infra/production/hybrid/api/export-current-container.sh \
  --container openbmb-api \
  --expected-source-sha <40-character-current-image-revision> \
  --output-dir /var/lib/openbmb/bootstrap

sudo bash infra/production/hybrid/api/install-native-api.sh \
  --domain sun227454.online
```

Before rendering any runtime configuration, the installer tightens
`/etc/openbmb/{infra,api}.env` to `root:root` mode `0600`. It then creates the
system user and directories, atomically installs the module and systemd
template, and writes a minimized `/etc/openbmb/native-api.env` as
`root:openbmb` mode `0640`. Only explicitly
reviewed application settings and derived application-scoped connection
values enter that file. MySQL root, LiveKit Redis, MinIO root/KMS and all raw
infrastructure credential keys are omitted; an unknown `api.env` key fails
closed. Reusing an infrastructure root password as an application credential
also fails closed. The runtime UID cannot read either source file.

The installer also writes `/etc/openbmb/native-api.hosts`. The unit
bind-mounts that file over its own
`/etc/hosts`; it maps the public application domain to `127.0.0.1`, preserving
S3 signed Host values without public-IP hairpin traffic. The host-wide
`/etc/hosts` is untouched and `/etc/resolv.conf` remains available for QQ SMTP
and the MiniCPM provider.

The unit wants Docker and the runtime-aware `openbmb.service`, orders itself
after both, and checks both are active in `ExecStartPre`. That fails a cold
start unless the prerequisites are active without binding the native process
to their later stop or restart lifecycle. The stack boundary waits for MySQL,
Redis, MinIO, ClamAV
and LiveKit health without starting Docker API/Web in hybrid mode. The native
unit deliberately does not order itself after hybrid recovery, because boot
recovery may need to `enable --now` a committed candidate. The recovery
barrier instead proves the selected slot active+enabled and the inactive slot
inactive+disabled before Caddy may start.

## LiveKit signing-secret rotation

After `/usr/local/sbin/openbmb-runtime-mode` has been installed, the full
release path treats `/etc/openbmb/infra.env` and
`/etc/openbmb/native-api.env` as one credential transaction. Rotation holds
the shared `/run/lock/openbmb-operation.lock` and fails closed unless runtime
mode is `docker`, no transition journal exists, Caddy points to the Docker API
at `127.0.0.1:13100`, and both native API units are exactly `inactive` and
`disabled`.

Before replacing either file, the rotation script invokes the installed,
root-owned Node `22.19.0` and native environment renderer against the
candidate infrastructure environment. The two candidates retain the source
metadata (`infra.env` remains root-only and `native-api.env` remains
`root:openbmb` mode `0640`). Both original inodes stay open until the two
renames and directory syncs are durable, so an ordinary command failure or
signal restores both inputs without leaving a named credential backup. The
script emits no credential values on success or failure. LiveKit and all API
runtimes must remain stopped if automatic restoration itself cannot be
proven.

The artifact layout is fixed:

```text
payload/
  manifest.json
  apps/server-api/package.json
  apps/server-api/dist/**
  node_modules/**
```

Manifest schema v1 records the full source SHA, deterministic release ID,
Node version, security epoch, deterministic Prisma schema/migration-tree digest and
the size/SHA-256 of every runtime file. The `.tar.gz.sha256` sidecar uses the
strict `digest<two spaces>basename` format. Before extraction, the streaming
Node validator checks gzip/tar checksums, canonical `payload/` paths, limits,
duplicates and PAX data and rejects links, devices, FIFOs and other special
entries. The extracted exact tree is then checked against the manifest before
it becomes a root-owned `0555/0444` release.

## Caddy switch helper interface

This module never edits the Caddyfile. Bootstrap supplies the root-owned,
non-symlink executable `/usr/local/libexec/openbmb-switch-api-upstream` with
this interface:

```text
openbmb-switch-api-upstream current
openbmb-switch-api-upstream switch \
  --expected-upstream 127.0.0.1:<old-port> \
  --target-upstream 127.0.0.1:<new-port>
openbmb-switch-api-upstream stage \
  --expected-upstream 127.0.0.1:<old-port> \
  --target-upstream 127.0.0.1:<new-port>
```

`current` writes exactly one upstream to stdout. `switch` is a compare-and-
swap: it atomically changes the authoritative upstream, validates and reloads
Caddy, and checks API live/readiness through Caddy. Exit `0` means a subsequent
`current` returns the target. On any failure it must restore and reload the
expected upstream before returning non-zero. The initial expected upstream
may be the Docker API at `127.0.0.1:13100` only through the journaled bootstrap
adapter. `stage` is reserved for boot recovery: it performs the same atomic
compare-and-swap and Caddy validation without attempting a reload while Caddy
is ordered behind the recovery service.

## Deploy, recovery and status

Callers pass both expected pointers so concurrent or stale automation cannot
activate an artifact:

```bash
sudo openbmb-deploy-native-api deploy \
  --artifact /path/openbmb-native-api-git-abc123def456.tar.gz \
  --sha256 /path/openbmb-native-api-git-abc123def456.tar.gz.sha256 \
  --expected-current-app git-9f4888d29af0 \
  --expected-current-api none
```

The artifact and sidecar inputs must be absolute, root-owned, regular files
that are not writable by group or other users. The deploy command pins them
into a root-only staging directory (hard link when possible, reflink/copy
otherwise) and performs both validation and extraction only from that pinned
inode, preventing upload-path replacement between the two operations.

Subsequent deploys pass the current native release instead of `none` and are
accepted only while runtime mode is settled `hybrid` and Caddy already points
to `13101` or `13102`. The
deploy holds the common production operation lock, validates the compatibility
anchor/floor/pending state, starts the inactive slot, polls direct live and
ready endpoints, invokes the Caddy compare-and-swap, then atomically advances
`current-api` and moves the former target to `previous-api`. Journal writes,
pointer changes and durable deletions are fsynced before the operation
continues. It stops the old native slot only after successful cutover.

Ordinary failures restore the old Caddy upstream, pointers and inactive slot.
If route restoration cannot be proven, the healthy candidate stays running
and the journal remains fail-closed. After a host/process interruption run:

```bash
sudo openbmb-deploy-native-api recover
sudo openbmb-deploy-native-api status
```

A `committed` journal is completed; an earlier phase is rolled back. Recovery
refuses to guess if Caddy points to neither journaled endpoint. The enabled
boot recovery service consumes both runtime and native journals before Caddy;
the candidate unit is deliberately not enabled until commit, avoiding a
persistent two-worker boot after an interrupted release.

Before switching from Docker fallback back to hybrid, the runtime adapter runs:

```bash
sudo openbmb-deploy-native-api compatibility
```

This verifies the active native manifest against the current Docker release's
Prisma tree, security epoch, durable security floor, and the derived LiveKit
signing credential against the root-only infrastructure source. A slow-path release
that advances any boundary stays in Docker mode until a dedicated rebootstrap.

Successful deploys and completed recoveries collect immutable releases that
are no longer referenced by `current-api`, `previous-api`, either slot, or the
pending journal. Failed deploys also collect an installed but unreferenced
candidate. Operators can inspect or run the same fail-closed GC:

```bash
sudo openbmb-deploy-native-api gc --dry-run
sudo openbmb-deploy-native-api gc --execute
```

Dry-run is the default. GC accepts only direct `git-<12-hex>` release
directories with the expected owner and immutable modes, and fsyncs the
release root after deletion.

## Local verification

Tests use only temporary directories and synthetic archives; they do not
connect to or mutate the production server:

```bash
bash infra/production/hybrid/api/test.sh
```
