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

Every successful `main` CI run delivers both the API and Web artifacts. This
deliberately avoids path-filter false negatives. Immediately before either
promotion, the runner rechecks the current remote `main` SHA. The server then
holds `/run/lock/openbmb-operation.lock`, requires exactly `mode=hybrid`, a
native `13101`/`13102` upstream, and `pending=no`, and only then calls the
stable promoter. Incoming cleanup is limited to eight precisely named,
owned, older-than-24-hours entries per run, and both upload and promotion are
guarded by an artifact-size-aware free-space check.

Automatic Web and API delivery requires both repository variables below:

```text
PRODUCTION_DEPLOY_ENABLED=true
PRODUCTION_DELIVERY_MODE=hybrid
```

The complete Docker delivery workflow is mutually exclusive, manual-only, and
activates only when `PRODUCTION_DELIVERY_MODE=docker-full` is explicitly
selected. It also rechecks remote `main` immediately before activation.
