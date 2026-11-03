# Hybrid release clients

The hybrid release path keeps stateful services in Docker while publishing the
two static web applications as one small, checksummed archive. It never reads
or embeds production application secrets.

## Local publish from Windows

Run a validation-only pass first:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\hybrid\publish-web.ps1 -DryRun
```

Publish the clean current `HEAD` through the configured `TX4H4G` SSH alias:

```powershell
$commit = git rev-parse HEAD
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\hybrid\publish-web.ps1 -ExpectedCommit $commit
```

`-ExecutionPolicy Bypass` applies only to this child PowerShell process. It
does not change the machine or user execution policy.

A real manual publish also requires that the same clean `HEAD` still equals
`origin/main` after the build and upload. If `main` advances, the uploaded
temporary archive is removed and no promotion occurs.

The script builds both workspaces, retains its staging directory and archive
under `tmp/hybrid-web/`, uploads with a unique name to the exact private
incoming path, verifies the remote hash, and invokes:

```text
/usr/local/sbin/openbmb-web-release promote <commit40> <archive-absolute-path> <sha256>
```

A failed publish deliberately leaves all local evidence in place. The one
remote incoming file is mode `0600` and is removed after either a successful or
failed promotion attempt; the privileged server entrypoint owns its own
root-only staging copy.

## Artifact contract

The archive root contains only:

```text
SHA256SUMS
site/openBMB/...
site/openBMB/admin/...
```

`SHA256SUMS` excludes itself. Its file paths are sorted bytewise, hashes are
lowercase SHA-256, and each record is `<hash><two spaces><relative path>` with
LF line endings.

The CI workflow uses `scripts/hybrid/package-web.sh` after building both web
workspaces. The shell packager validates the clean, exact checkout and archive
contents before a transfer can begin.

## Native API delivery

Native API artifacts must be built on the pinned `ubuntu-24.04` x64 runner
with Node.js `22.19.0` and npm `11.4.2`; do not build them from Windows because
`node_modules` contains platform-specific native binaries. After the main CI
workflow succeeds,
`.github/workflows/api-production-delivery.yml` installs only the server
workspace, builds it, prunes development dependencies, and invokes:

```bash
bash scripts/hybrid/package-api.sh \
  <40-character-commit> \
  /absolute/path/openbmb-native-api-git-<12-character-commit>.tar.gz
```

The workflow prunes and validates the complete npm production closure. The
packager includes both hoisted dependencies and any workspace-local production
`node_modules`, creates the existing `payload/manifest.json` contract, rejects
a dirty or mismatched checkout, dereferences npm workspace/bin links without
emitting tar hard-link members, and verifies both the archive and extracted
tree before upload.

Every successful `main` CI run can deliver API and/or Web artifacts depending on
what changed, when both `PRODUCTION_DEPLOY_ENABLED=true` and
`PRODUCTION_DELIVERY_MODE=hybrid` are configured. Merely merging this workflow
does not enable deployment; `false` or a missing mode keeps it disabled.
API delivery is the CI-triggered coordinator and the only manual hybrid workflow
entry. Web is reusable-only, and waits for the API fast path or full upgrade to succeed (or a
valid no-change decision). The exact source SHA and original CI run ID are passed
to Web so its directory filter still examines the original changes.
The change detector evaluates:

- `apps/server-api`, `packages/api-contracts`, `packages/event-contracts`
- `apps/client-web`, `apps/admin-web`, `design-system`, `packages/api-contracts`,
  `packages/event-contracts`

Each component is reconciled from its currently promoted full source SHA. A
non-production planning job reads that SHA only from an explicit successful
`DEPLOYED` or `RECONCILED` marker written by a completed protected delivery; it
never treats a successful CI run or GitHub's automatic deployment SHA as proof
of promotion. When relevant changes exist, the protected job independently
reads immutable production release metadata while the server operation lock is
held and reconciles again before it builds. An unavailable, malformed,
non-ancestor, or otherwise untrusted marker or server baseline fails open and
publishes the component. A manual dispatch always forces publication.

The workflow summary reports `DEPLOYED`, `SKIPPED`, or `FAILED`. A normal
no-change decision completes in the planning job, so it does not open the
protected `production` environment or create a production deployment record.
During marker bootstrap or recovery, the protected job may discover that the
locked server is already current; that one run is reported as `SKIPPED` and
writes a `RECONCILED` marker for later planning runs.

Immediately before either promotion, the runner rechecks the current remote `main`
SHA and a successful same-SHA push-to-main CI run from this repository. Reusable
workflows prefer the explicit `source_sha` input, never the caller event's default
SHA. The server then
holds `/run/lock/openbmb-operation.lock`, requires exactly `mode=hybrid`, a
native `13101`/`13102` upstream, and `pending=no`, and only then calls the
stable promoter. Incoming cleanup is limited to eight precisely named,
owned, older-than-24-hours entries per run, and both upload and promotion are
guarded by an artifact-size-aware free-space check.

After reading the real locked native baseline, the API router compares the
candidate Prisma tree digest (`sha256:<64 hex>`) and security epoch with the
root-owned `current-app` anchor. Equal values use the fast native path; changed
Prisma or a newer epoch calls the complete Docker workflow with
`return_to_hybrid=true`. Invalid/pending server state and an epoch downgrade fail
closed: they are not instructions to repair production. This compatibility guard
is distinct from a missing planning marker, which can safely request a rebuild.

The reusable complete Docker workflow first verifies current main and same-SHA
CI, then restores only missing fallback application images from the root-owned
anchor's exact recorded GHCR digests. It checks original image identity and OCI
revision before tagging, refuses conflicting existing tags, uses a temporary
root-only registry credential directory, and never starts containers or changes
data during restoration. Package-access denial stops before building or switching;
it never substitutes a digest or rebuilds an old image. Downloads are bounded.

The existing guarded Docker switch, backup, Prisma migration and security-boundary
upgrade remain authoritative. After Docker health passes, the workflow installs
the candidate hybrid controls, exports that exact Docker API, and explicitly runs
reviewed rebootstrap with both expected current pointers. Only after local/public
hybrid health and source identity pass does it write the API success marker and
release Web delivery. Export evidence is retained under
`/var/lib/openbmb/hybrid-upgrade.*`; failures leave inspectable state, not a success
marker. Before Docker activation the workflow rechecks latest main and same-SHA
CI. Once that exact source is activated, hybrid completion verifies the attested
current-app identity and same-SHA CI but deliberately does not reject a newer
main: completing this safety transition must not leave Docker mode stranded.
To publish manually, dispatch API production delivery; there is no independent
Web dispatch that could put new UI ahead of its required API.

Standalone full Docker delivery remains manual and requires
`PRODUCTION_DELIVERY_MODE=docker-full`. Caller and callee concurrency groups are
distinct; server operations still use the shared production lock.

Local workflow/router/restoration checks:

```powershell
powershell -File scripts/hybrid/test-delivery-static.ps1
node --test scripts/hybrid/api-upgrade-route.test.mjs scripts/hybrid/delivery-contract.test.mjs
```

These mocked/static checks do not establish GHCR package authorization or prove a
live production upgrade. Confirm those through the protected delivery run.
