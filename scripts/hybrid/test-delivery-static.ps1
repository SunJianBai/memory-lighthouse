[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Contains {
    param(
        [Parameter(Mandatory)]
        [string] $Text,

        [Parameter(Mandatory)]
        [string] $Needle,

        [Parameter(Mandatory)]
        [string] $Description
    )

    if ($Text.IndexOf($Needle, [System.StringComparison]::Ordinal) -lt 0) {
        throw "Missing delivery invariant: $Description"
    }
}

function Assert-NotContains {
    param(
        [Parameter(Mandatory)]
        [string] $Text,

        [Parameter(Mandatory)]
        [string] $Needle,

        [Parameter(Mandatory)]
        [string] $Description
    )

    if ($Text.IndexOf($Needle, [System.StringComparison]::Ordinal) -ge 0) {
        throw "Forbidden delivery state: $Description"
    }
}

function Assert-Before {
    param(
        [Parameter(Mandatory)]
        [string] $Text,

        [Parameter(Mandatory)]
        [string] $First,

        [Parameter(Mandatory)]
        [string] $Second,

        [Parameter(Mandatory)]
        [string] $Description
    )

    $firstIndex = $Text.IndexOf($First, [System.StringComparison]::Ordinal)
    $secondIndex = $Text.IndexOf($Second, [System.StringComparison]::Ordinal)
    if ($firstIndex -lt 0 -or $secondIndex -lt 0 -or $firstIndex -ge $secondIndex) {
        throw "Invalid delivery ordering: $Description"
    }
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$webWorkflow = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot '.github\workflows\web-production-delivery.yml')
)
$dockerWorkflow = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot '.github\workflows\production-delivery.yml')
)
$apiWorkflowPath = Join-Path $projectRoot '.github\workflows\api-production-delivery.yml'
if (-not [System.IO.File]::Exists($apiWorkflowPath)) {
    throw 'Missing delivery invariant: native API production workflow'
}
$apiWorkflow = [System.IO.File]::ReadAllText($apiWorkflowPath)
$caddyfile = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot 'infra\production\caddy\Caddyfile')
)
$readme = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'README.md'))
$publishWeb = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'publish-web.ps1'))
$packageApi = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'package-api.sh'))
$assertCurrentMain = [System.IO.File]::ReadAllText(
    (Join-Path $PSScriptRoot 'assert-current-main.sh')
)
$prepareIncoming = [System.IO.File]::ReadAllText(
    (Join-Path $PSScriptRoot 'prepare-remote-incoming.sh')
)
$promotionGuard = [System.IO.File]::ReadAllText(
    (Join-Path $PSScriptRoot 'remote-promotion-guard.sh')
)
$deployRelease = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot 'infra\production\scripts\deploy-release.sh')
)

Assert-Contains $webWorkflow 'workflow_run:' 'Web delivery waits for CI'
Assert-NotContains $webWorkflow "`n  push:" 'Web delivery must not race the CI push run'
Assert-Contains $webWorkflow "workflows: [CI]" 'Web delivery names the CI workflow'
Assert-Contains $webWorkflow "github.event.workflow_run.conclusion == 'success'" 'Web delivery requires successful CI'
Assert-Contains $webWorkflow "github.event.workflow_run.head_repository.full_name == github.repository" 'Web delivery rejects foreign repositories'
Assert-Contains $webWorkflow 'detect-release-changes.sh web ${SOURCE_SHA} ${{ github.event.workflow_run.id }}' 'Web delivery uses the triggering CI run for change detection'
Assert-Contains $webWorkflow 'prepare-remote-incoming.sh' 'Web delivery performs bounded incoming cleanup and disk preflight'
Assert-Contains $webWorkflow 'remote-promotion-guard.sh' 'Web promotion uses the server-side shared-lock guard'
Assert-Before $webWorkflow 'scp -- "$ARCHIVE"' 'assert-current-main.sh "$SOURCE_SHA"' 'Web remote-main check follows upload'
Assert-Before $webWorkflow 'assert-current-main.sh "$SOURCE_SHA"' 'web "$SOURCE_SHA" "$REMOTE_ARCHIVE"' 'Web rechecks remote main immediately before guarded promotion'

Assert-Contains $apiWorkflow 'workflow_run:' 'API delivery waits for CI'
Assert-NotContains $apiWorkflow "`n  push:" 'API delivery must not race the CI push run'
Assert-Contains $apiWorkflow "github.event.workflow_run.conclusion == 'success'" 'API delivery requires successful CI'
Assert-Contains $apiWorkflow "github.event.workflow_run.head_repository.full_name == github.repository" 'API delivery rejects foreign repositories'
Assert-Contains $apiWorkflow 'scripts/hybrid/package-api.sh' 'API delivery builds the native artifact'
Assert-Contains $apiWorkflow 'detect-release-changes.sh api ${SOURCE_SHA} ${{ github.event.workflow_run.id }}' 'API delivery uses the triggering CI run for change detection'
Assert-Contains $apiWorkflow 'runs-on: ubuntu-24.04' 'API runner OS is pinned'
Assert-Contains $apiWorkflow 'architecture: x64' 'API runner architecture is pinned'
Assert-Contains $apiWorkflow 'npm install --global npm@11.4.2' 'API npm version is pinned'
Assert-Contains $apiWorkflow '--package-lock=false' 'API pruning cannot dirty the tracked lockfile'
Assert-Contains $apiWorkflow 'npm ls --omit=dev --all' 'API production dependency closure is checked'
Assert-Contains $apiWorkflow 'prepare-remote-incoming.sh' 'API delivery performs bounded incoming cleanup and disk preflight'
Assert-Contains $apiWorkflow 'remote-promotion-guard.sh' 'API promotion uses the server-side shared-lock guard'
Assert-Before $apiWorkflow 'scp -- "$ARCHIVE" "$SIDECAR"' 'assert-current-main.sh "$SOURCE_SHA"' 'API remote-main check follows upload'
Assert-Before $apiWorkflow 'assert-current-main.sh "$SOURCE_SHA"' 'api "$SOURCE_SHA" "$REMOTE_DIRECTORY/$ARCHIVE_NAME"' 'API rechecks remote main immediately before guarded promotion'

Assert-Contains $dockerWorkflow "vars.PRODUCTION_DEPLOY_ENABLED == 'true'" 'Docker delivery requires explicit enablement'
Assert-Contains $dockerWorkflow "vars.PRODUCTION_DELIVERY_MODE == 'docker-full'" 'Docker delivery is docker-full-only'
Assert-Contains $dockerWorkflow 'workflow_dispatch:' 'Docker delivery has an explicit manual trigger'
Assert-NotContains $dockerWorkflow 'workflow_run:' 'Docker full delivery must remain manual-only'
Assert-NotContains $dockerWorkflow 'ACTIVATE_RELEASE' 'Manual Docker delivery must not silently skip activation'
Assert-Contains $dockerWorkflow 'Reject stale manual activation' 'Manual Docker activation rechecks remote main'
Assert-Contains $dockerWorkflow 'runtime_status="$(sudo -n "$runtime_mode" status)"' 'Docker activation reads runtime control-plane status'
Assert-Contains $dockerWorkflow 'sudo -n test -L "$runtime_mode"' 'Docker activation detects a broken or hostile runtime-control symlink'
Assert-Contains $dockerWorkflow 'sudo -n test ! -L "$runtime_mode"' 'Docker activation rejects a runtime-control symlink'
Assert-Contains $dockerWorkflow 'runtime_state=/var/lib/openbmb/hybrid-runtime' 'Docker activation treats durable hybrid state as installed evidence'
Assert-Contains $dockerWorkflow '[[ "$runtime_pending" == no ]]' 'Docker activation rejects a pending runtime transition'
Assert-Contains $dockerWorkflow 'hybrid) sudo -n "$runtime_mode" switch docker ;;' 'Docker activation switches only from hybrid mode'
Assert-Contains $dockerWorkflow 'docker) ;;' 'Docker activation accepts an already-Docker runtime'
Assert-Before $dockerWorkflow 'deploy-release.sh"' 'systemctl restart openbmb.service' 'Failed boot services are recovered only after deploy releases the operation lock'
Assert-Before $dockerWorkflow 'systemctl restart openbmb.service' 'systemctl restart openbmb-hybrid-recovery.service' 'Stack dependencies recover before the hybrid recovery barrier'
Assert-Before $dockerWorkflow 'systemctl restart openbmb-hybrid-recovery.service' 'systemctl restart caddy.service' 'Caddy recovers only after the hybrid barrier'
Assert-Contains $dockerWorkflow "mode=docker\nupstream=127.0.0.1:13100\npending=no" 'Post-deploy service recovery revalidates exact Docker runtime state'

Assert-Contains $assertCurrentMain "git/ref/heads/main" 'Remote-main guard reads the authoritative GitHub ref'
Assert-Contains $assertCurrentMain '[[ "$current_main" == "$source_sha" ]]' 'Remote-main guard rejects a stale source SHA'
Assert-Contains $prepareIncoming 'readonly cleanup_limit=8' 'Stale incoming cleanup is bounded'
Assert-Contains $prepareIncoming 'readonly stale_minutes=1440' 'Stale incoming cleanup has a minimum age'
Assert-Contains $prepareIncoming 'stat -c %u' 'Stale incoming cleanup checks ownership'
Assert-Contains $prepareIncoming 'df -P -B1' 'Incoming preparation checks disk capacity'
Assert-Contains $promotionGuard 'readonly operation_lock=/run/lock/openbmb-operation.lock' 'Promotions share the production operation lock'
Assert-Contains $promotionGuard 'OPENBMB_OPERATION_LOCK_HELD=true' 'Promoters inherit the already-held shared lock'
Assert-Contains $promotionGuard '[[ "${lines[0]}" == mode=hybrid ]]' 'Promotion requires exact hybrid mode'
Assert-Contains $promotionGuard 'upstream=(127\.0\.0\.1:1310[12])' 'Promotion requires a native API upstream'
Assert-Contains $promotionGuard '[[ "${lines[2]}" == pending=no ]]' 'Promotion requires no pending runtime transition'
Assert-NotContains $promotionGuard '127.0.0.1:13100/openBMB' 'Same-SHA promotion cannot accept Docker port 13100'
Assert-Contains $promotionGuard 'df -P -B1' 'Promotion repeats disk capacity preflight under the shared lock'
Assert-Contains $promotionGuard 'upload-preflight)' 'Upload preflight runs under the shared operation lock'
Assert-Contains $promotionGuard '"$api_deployer" gc --execute' 'API upload preflight cleans unreachable staging under the lock'
Assert-Contains $promotionGuard '"$web_deployer" status >/dev/null' 'Web upload preflight cleans aged root staging under the lock'
Assert-Contains $promotionGuard 'assert_disk_capacity /opt/openbmb' 'Upload preflight checks the release filesystem after cleanup'
Assert-Contains $packageApi 'apps/server-api/node_modules' 'API artifact includes workspace-local production dependencies'
Assert-Contains $publishWeb '$postBuildDirtyStatus' 'Manual Web publish repeats the dirty-worktree check after build'
Assert-Contains $publishWeb '$postBuildHead' 'Manual Web publish repeats the HEAD check after build'
Assert-Contains $publishWeb 'ls-remote --exit-code --refs origin refs/heads/main' 'Manual Web publish rechecks remote main before promotion'
Assert-Contains $deployRelease 'OPENBMB_OPERATION_LOCK_HELD=true' 'Docker slow deploy holds the shared operation lock'
Assert-Contains $deployRelease 'runtime_modes[0]}" == docker' 'Docker slow deploy requires Docker runtime mode before mutation'
Assert-Contains $deployRelease '-e "$runtime_mode_state" || -L "$runtime_mode_state"' 'Docker slow deploy fails closed on durable hybrid-state evidence'
Assert-Contains $deployRelease 'hybrid runtime control exists but is unsafe' 'Docker slow deploy rejects a corrupt runtime control'
Assert-Contains $deployRelease 'runtime_upstreams[0]}" == 127.0.0.1:13100' 'Docker slow deploy requires Docker upstream 13100'
Assert-Contains $deployRelease 'runtime_pending[0]}" == no' 'Docker slow deploy requires settled runtime state'
Assert-Contains $caddyfile '# SPA entrypoints and fallback HTML must never outlive the' 'client SPA cache boundary is explicit'
Assert-Contains $readme '-ExecutionPolicy Bypass' 'Windows invocation works under the default restricted policy'
Assert-Contains $readme 'Every successful `main` CI run can deliver API and/or Web artifacts depending on' 'Documentation matches change-filtered component delivery'
Assert-Contains $readme 'manual-only' 'Documentation matches the Docker workflow trigger'

Write-Host 'Hybrid delivery static invariants passed.'
