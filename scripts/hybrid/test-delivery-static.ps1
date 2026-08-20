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

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$webWorkflow = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot '.github/workflows/web-production-delivery.yml')
)
$dockerWorkflow = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot '.github/workflows/production-delivery.yml')
)
$apiWorkflowPath = Join-Path $projectRoot '.github/workflows/api-production-delivery.yml'
if (-not [System.IO.File]::Exists($apiWorkflowPath)) {
    throw 'Missing delivery invariant: native API production workflow'
}
$apiWorkflow = [System.IO.File]::ReadAllText($apiWorkflowPath)
$ciWorkflow = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot '.github/workflows/ci.yml')
)
$caddyfile = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot 'infra/production/caddy/Caddyfile')
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
$detectReleaseChanges = [System.IO.File]::ReadAllText(
    (Join-Path $PSScriptRoot 'detect-release-changes.sh')
)
$deploymentMarker = [System.IO.File]::ReadAllText(
    (Join-Path $PSScriptRoot 'production-deployment-marker.sh')
)
$deployRelease = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot 'infra/production/scripts/deploy-release.sh')
)
$validateStatic = [System.IO.File]::ReadAllText(
    (Join-Path $projectRoot 'infra/production/scripts/validate-static.sh')
)

Assert-Contains $ciWorkflow 'scripts/hybrid/test-delivery-static.ps1' 'CI executes hybrid workflow invariants'
Assert-Contains $validateStatic 'test-detect-release-changes.sh' 'CI exercises production-baseline reconciliation behavior'
Assert-Contains $validateStatic 'test-production-deployment-marker.sh' 'CI exercises durable promotion markers'

Assert-Contains $webWorkflow "  plan-web:" 'Web skip planning has a non-production job'
Assert-Contains $webWorkflow 'needs: plan-web' 'Web production job requires a positive plan'
Assert-Contains $webWorkflow "if: needs.plan-web.outputs.should_release == 'true'" 'Web production environment is entered only for reconciliation'
$webPlanStart = $webWorkflow.IndexOf("  plan-web:", [System.StringComparison]::Ordinal)
$webDeliveryStart = $webWorkflow.IndexOf("  deliver-web:", [System.StringComparison]::Ordinal)
if ($webPlanStart -lt 0 -or $webDeliveryStart -le $webPlanStart) {
    throw 'Invalid delivery ordering: Web plan must precede production delivery'
}
$webPlan = $webWorkflow.Substring($webPlanStart, $webDeliveryStart - $webPlanStart)
Assert-NotContains $webPlan 'environment: production' 'Web no-change plan must not create a production deployment'
if ([regex]::Matches($webWorkflow, '(?m)^    environment: production\r?$').Count -ne 1) {
    throw 'Invalid delivery invariant: only the Web reconciliation job may use production'
}

Assert-Contains $apiWorkflow "  plan-api:" 'API skip planning has a non-production job'
Assert-Contains $apiWorkflow 'needs: plan-api' 'API production job requires a positive plan'
Assert-Contains $apiWorkflow "if: needs.plan-api.outputs.should_release == 'true'" 'API production environment is entered only for reconciliation'
$apiPlanStart = $apiWorkflow.IndexOf("  plan-api:", [System.StringComparison]::Ordinal)
$apiDeliveryStart = $apiWorkflow.IndexOf("  deliver-api:", [System.StringComparison]::Ordinal)
if ($apiPlanStart -lt 0 -or $apiDeliveryStart -le $apiPlanStart) {
    throw 'Invalid delivery ordering: API plan must precede production delivery'
}
$apiPlan = $apiWorkflow.Substring($apiPlanStart, $apiDeliveryStart - $apiPlanStart)
Assert-NotContains $apiPlan 'environment: production' 'API no-change plan must not create a production deployment'
if ([regex]::Matches($apiWorkflow, '(?m)^    environment: production\r?$').Count -ne 1) {
    throw 'Invalid delivery invariant: only the API reconciliation job may use production'
}

Assert-Contains $webWorkflow 'workflow_run:' 'Web delivery waits for CI'
Assert-Contains $webWorkflow 'workflow_dispatch:' 'Web delivery retains forced manual publication'
Assert-NotContains $webWorkflow "`n  push:" 'Web delivery must not race the CI push run'
Assert-Contains $webWorkflow "workflows: [CI]" 'Web delivery names the CI workflow'
Assert-Contains $webWorkflow "github.event.workflow_run.conclusion == 'success'" 'Web delivery requires successful CI'
Assert-Contains $webWorkflow "github.event.workflow_run.head_repository.full_name == github.repository" 'Web delivery rejects foreign repositories'
Assert-Contains $webWorkflow 'detect-release-changes.sh web "$SOURCE_SHA" "${{ github.event.workflow_run.id }}" "$production_sha"' 'Web delivery reconciles from the promoted production SHA'
Assert-Contains $webWorkflow 'baseline web' 'Web delivery reads the locked production baseline'
Assert-Before $webWorkflow 'Configure pinned SSH identity' 'Verify locked production Web baseline' 'Web baseline SSH is available before production verification'
Assert-Contains $webWorkflow '### Web production delivery: SKIPPED' 'Web skip is explicit in the job summary'
Assert-Contains $webWorkflow '### Web production delivery: DEPLOYED' 'Web promotion is explicit in the job summary'
Assert-Contains $webWorkflow "production_sha='manual-force'" 'Manual Web delivery bypasses the directory filter'
Assert-Contains $webWorkflow 'production-deployment-marker.sh mark web' 'Web delivery records a durable reconciliation marker'
Assert-Before $webWorkflow 'Remove ephemeral SSH material' 'Record verified Web reconciliation marker' 'Web cleanup completes before a success marker is written'
Assert-Before $webWorkflow 'Record Web delivery result' 'Record verified Web reconciliation marker' 'Web summary completes before a success marker is written'
$webMarkerStart = $webWorkflow.IndexOf('      - name: Record verified Web reconciliation marker', [System.StringComparison]::Ordinal)
if ($webMarkerStart -lt 0 -or $webWorkflow.IndexOf("`n      - name:", $webMarkerStart + 1, [System.StringComparison]::Ordinal) -ge 0) {
    throw 'Invalid delivery ordering: Web success marker must be the final workflow step'
}
Assert-Contains $webWorkflow 'prepare-remote-incoming.sh' 'Web delivery performs bounded incoming cleanup and disk preflight'
Assert-Contains $webWorkflow 'remote-promotion-guard.sh' 'Web promotion uses the server-side shared-lock guard'
Assert-Before $webWorkflow 'scp -- "$ARCHIVE"' 'assert-current-main.sh "$SOURCE_SHA"' 'Web remote-main check follows upload'
Assert-Before $webWorkflow 'assert-current-main.sh "$SOURCE_SHA"' 'web "$SOURCE_SHA" "$REMOTE_ARCHIVE"' 'Web rechecks remote main immediately before guarded promotion'

Assert-Contains $apiWorkflow 'workflow_run:' 'API delivery waits for CI'
Assert-Contains $apiWorkflow 'workflow_dispatch:' 'API delivery retains forced manual publication'
Assert-NotContains $apiWorkflow "`n  push:" 'API delivery must not race the CI push run'
Assert-Contains $apiWorkflow "github.event.workflow_run.conclusion == 'success'" 'API delivery requires successful CI'
Assert-Contains $apiWorkflow "github.event.workflow_run.head_repository.full_name == github.repository" 'API delivery rejects foreign repositories'
Assert-Contains $apiWorkflow 'scripts/hybrid/package-api.sh' 'API delivery builds the native artifact'
Assert-Contains $apiWorkflow 'detect-release-changes.sh api "$SOURCE_SHA" "${{ github.event.workflow_run.id }}" "$production_sha"' 'API delivery reconciles from the promoted production SHA'
Assert-Contains $apiWorkflow 'baseline api' 'API delivery reads the locked production baseline'
Assert-Before $apiWorkflow 'Configure pinned SSH identity' 'Verify locked production API baseline' 'API baseline SSH is available before production verification'
Assert-Contains $apiWorkflow '### API production delivery: SKIPPED' 'API skip is explicit in the job summary'
Assert-Contains $apiWorkflow '### API production delivery: DEPLOYED' 'API promotion is explicit in the job summary'
Assert-Contains $apiWorkflow "production_sha='manual-force'" 'Manual API delivery bypasses the directory filter'
Assert-Contains $apiWorkflow 'production-deployment-marker.sh mark api' 'API delivery records a durable reconciliation marker'
Assert-Before $apiWorkflow 'Remove ephemeral SSH material' 'Record verified API reconciliation marker' 'API cleanup completes before a success marker is written'
Assert-Before $apiWorkflow 'Record API delivery result' 'Record verified API reconciliation marker' 'API summary completes before a success marker is written'
$apiMarkerStart = $apiWorkflow.IndexOf('      - name: Record verified API reconciliation marker', [System.StringComparison]::Ordinal)
if ($apiMarkerStart -lt 0 -or $apiWorkflow.IndexOf("`n      - name:", $apiMarkerStart + 1, [System.StringComparison]::Ordinal) -ge 0) {
    throw 'Invalid delivery ordering: API success marker must be the final workflow step'
}
Assert-Contains $apiWorkflow 'runs-on: ubuntu-24.04' 'API runner OS is pinned'
Assert-Contains $apiWorkflow 'architecture: x64' 'API runner architecture is pinned'
Assert-Contains $apiWorkflow 'npm install --global npm@11.4.2' 'API npm version is pinned'
Assert-Contains $apiWorkflow '--package-lock=false' 'API pruning cannot dirty the tracked lockfile'
Assert-Contains $apiWorkflow 'npm ls --omit=dev --all' 'API production dependency closure is checked'
Assert-Contains $apiWorkflow 'Verify build and pruning preserved immutable source' 'API dirty-source failure is diagnosed at its origin'
Assert-Before $apiWorkflow 'Verify build and pruning preserved immutable source' 'Package and verify the native API artifact' 'API source cleanliness is proven before packaging'
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
Assert-Contains $promotionGuard 'baseline)' 'Production baselines are read under the shared operation lock'
Assert-Before $promotionGuard 'exec 9<>"$operation_lock"' 'baseline)' 'Baseline reads occur only after the production lock is held'
Assert-Contains $promotionGuard 'sourceSha' 'API baseline is recovered from the full immutable manifest SHA'
Assert-Contains $promotionGuard 'source_sha=' 'Web baseline is recovered from immutable release metadata'
Assert-Contains $promotionGuard '"$api_deployer" gc --execute' 'API upload preflight cleans unreachable staging under the lock'
Assert-Contains $promotionGuard '"$web_deployer" status >/dev/null' 'Web upload preflight cleans aged root staging under the lock'
Assert-Contains $promotionGuard 'assert_disk_capacity /opt/openbmb' 'Upload preflight checks the release filesystem after cleanup'
Assert-Contains $packageApi 'apps/server-api/node_modules' 'API artifact includes workspace-local production dependencies'
Assert-Contains $packageApi 'refusing to package a dirty worktree' 'API packaging retains the clean-source boundary'
Assert-Contains $detectReleaseChanges '<production-sha40>' 'Change detection requires a promoted production baseline'
Assert-NotContains $detectReleaseChanges 'actions/workflows/ci.yml/runs' 'Successful CI runs must not stand in for successful promotions'
Assert-Contains $deploymentMarker 'OPENBMB $component_label $result $source_sha' 'Deployment marker binds result to the validated full source SHA'
Assert-Contains $deploymentMarker '/actions/runs/' 'Deployment marker identifies the current protected job by run URL'
Assert-NotContains $deploymentMarker 'sha=$source_sha' 'Deployment marker must not trust workflow-run deployment SHA identity'
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
Assert-Contains $readme 'currently promoted full source SHA' 'Documentation identifies the reconciliation baseline'
Assert-Contains $readme '`DEPLOYED`, `SKIPPED`, or `FAILED`' 'Documentation explains delivery result summaries'
Assert-Contains $readme 'manual-only' 'Documentation matches the Docker workflow trigger'

Write-Host 'Hybrid delivery static invariants passed.'
