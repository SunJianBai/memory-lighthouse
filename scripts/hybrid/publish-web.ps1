[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string] $ExpectedCommit,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
    [string] $SshHost = 'TX4H4G',

    [ValidatePattern('^/[A-Za-z0-9._/-]+$')]
    [string] $RemoteIncomingDirectory = '/home/ubuntu/.openbmb-web-incoming',

    [string] $OutputDirectory,

    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)]
        [string] $FilePath,

        [Parameter(Mandatory)]
        [string[]] $ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath"
    }
}

function Invoke-CheckedCommandWithInput {
    param(
        [Parameter(Mandatory)]
        [string] $InputText,

        [Parameter(Mandatory)]
        [string] $FilePath,

        [Parameter(Mandatory)]
        [string[]] $ArgumentList
    )

    $InputText | & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath"
    }
}

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory)]
        [string] $LiteralPath
    )

    $stream = [System.IO.File]::OpenRead($LiteralPath)
    try {
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $hasher.ComputeHash($stream)
        }
        finally {
            $hasher.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }

    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-RequiredCommandPath {
    param(
        [Parameter(Mandatory)]
        [string[]] $Names
    )

    foreach ($name in $Names) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $command) {
            return $command.Source
        }
    }

    throw "Required command is missing: $($Names -join ' or ')"
}

function Get-StagedRelativePath {
    param(
        [Parameter(Mandatory)]
        [string] $BasePath,

        [Parameter(Mandatory)]
        [string] $ChildPath
    )

    $baseFullPath = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\') + '\'
    $childFullPath = [System.IO.Path]::GetFullPath($ChildPath)
    if (-not $childFullPath.StartsWith(
        $baseFullPath,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Path escaped staging root: $childFullPath"
    }

    return $childFullPath.Substring($baseFullPath.Length).Replace('\', '/')
}

function Assert-SafeArtifactPath {
    param(
        [Parameter(Mandatory)]
        [string] $RelativePath
    )

    $pathBytes = [System.Text.Encoding]::UTF8.GetByteCount($RelativePath)
    if ($pathBytes -gt 512 -or
        $RelativePath -notmatch '^site/openBMB(?:/[A-Za-z0-9._@+-]+)*$') {
        throw "Artifact path is not accepted by the server contract: $RelativePath"
    }
}

$scriptDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..\..'))
$gitPath = Get-RequiredCommandPath -Names @('git.exe', 'git')
$npmPath = Get-RequiredCommandPath -Names @('npm.cmd', 'npm.exe', 'npm')
$tarPath = Get-RequiredCommandPath -Names @('tar.exe', 'bsdtar.exe', 'bsdtar')
$scpPath = Get-RequiredCommandPath -Names @('scp.exe', 'scp')
$sshPath = Get-RequiredCommandPath -Names @('ssh.exe', 'ssh')
$prepareIncomingScriptPath = Join-Path $scriptDirectory 'prepare-remote-incoming.sh'
$promotionGuardScriptPath = Join-Path $scriptDirectory 'remote-promotion-guard.sh'
foreach ($requiredScript in @($prepareIncomingScriptPath, $promotionGuardScriptPath)) {
    if (-not (Test-Path -LiteralPath $requiredScript -PathType Leaf)) {
        throw "Required hybrid delivery helper is missing: $requiredScript"
    }
}
$prepareIncomingScript = [System.IO.File]::ReadAllText($prepareIncomingScriptPath)
$promotionGuardScript = [System.IO.File]::ReadAllText($promotionGuardScriptPath)
$sshOptions = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ConnectionAttempts=2'
)

$actualRoot = (& $gitPath -C $projectRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to resolve the Git repository root.'
}
$resolvedActualRoot = [System.IO.Path]::GetFullPath($actualRoot)
if (-not $resolvedActualRoot.Equals($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected Git repository root: $resolvedActualRoot"
}

$headCommit = (& $gitPath -C $projectRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $headCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to resolve a full 40-character HEAD commit.'
}
if ($ExpectedCommit -and $headCommit -ne $ExpectedCommit.ToLowerInvariant()) {
    throw "HEAD mismatch: expected $ExpectedCommit, got $headCommit"
}

$remoteDirectory = $RemoteIncomingDirectory.TrimEnd('/')
if (-not $remoteDirectory -or
    $remoteDirectory.Contains('//') -or
    $remoteDirectory.Split('/') -contains '..') {
    throw "RemoteIncomingDirectory is not canonical: $RemoteIncomingDirectory"
}

if (-not $OutputDirectory) {
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $OutputDirectory = Join-Path $projectRoot "tmp\hybrid-web\$headCommit-$timestamp"
}
$evidenceRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if (-not $evidenceRoot.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputDirectory must stay inside the project workspace.'
}

$dirtyStatus = (& $gitPath -C $projectRoot status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the Git worktree.'
}
if (-not $DryRun -and $dirtyStatus) {
    throw 'Refusing to publish a dirty worktree. Commit or stash local changes first.'
}

Write-Host "Validated repository HEAD: $headCommit"
Write-Host "Evidence directory: $evidenceRoot"
if ($dirtyStatus -and $DryRun) {
    Write-Warning 'Dry-run detected a dirty worktree; a real publish would stop here.'
}

if ($DryRun) {
    Write-Host 'Dry-run successful. No build, archive, network transfer, or promotion was performed.'
    Write-Host "Planned remote path: $remoteDirectory/openbmb-web-$headCommit-<sha256>-<nonce>.tar.zst"
    exit 0
}

[System.IO.Directory]::CreateDirectory($evidenceRoot) | Out-Null
$stageRoot = Join-Path $evidenceRoot 'stage'
if ([System.IO.Directory]::Exists($stageRoot) -or [System.IO.File]::Exists($stageRoot)) {
    throw "Refusing to overwrite existing staging evidence: $stageRoot"
}
[System.IO.Directory]::CreateDirectory($stageRoot) | Out-Null

$remoteArchivePath = $null
$remoteUploadAttempted = $false
try {
    Push-Location $projectRoot
    try {
        $env:VITE_API_BASE_URL = '/openBMB/api/v1'
        $env:VITE_API_BASE = '/openBMB/api/v1'
        $env:VITE_DEPLOYMENT_ENVIRONMENT = 'production'
        $env:VITE_ENABLE_DEVELOPMENT_CONTENT_INSPECTION = 'false'
        Invoke-CheckedCommand -FilePath $npmPath -ArgumentList @(
            'run', 'build', '--workspace', '@memory-lighthouse/client-web'
        )
        Invoke-CheckedCommand -FilePath $npmPath -ArgumentList @(
            'run', 'build', '--workspace', '@memory-lighthouse/admin-web'
        )
    }
    finally {
        Pop-Location
    }

    $postBuildHead = (& $gitPath -C $projectRoot rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $postBuildHead -ne $headCommit) {
        throw "Repository HEAD changed during the Web build: expected $headCommit, got $postBuildHead"
    }
    $postBuildDirtyStatus = (& $gitPath -C $projectRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to repeat the Git worktree check after the Web build.'
    }
    if ($postBuildDirtyStatus) {
        throw 'Refusing to publish because the worktree became dirty during the Web build.'
    }

    $clientDist = Join-Path $projectRoot 'apps\client-web\dist'
    $adminDist = Join-Path $projectRoot 'apps\admin-web\dist'
    if (-not (Test-Path -LiteralPath (Join-Path $clientDist 'index.html') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $adminDist 'index.html') -PathType Leaf)) {
        throw 'Both web builds must contain an index.html entry point.'
    }
    if (Test-Path -LiteralPath (Join-Path $clientDist 'admin')) {
        throw 'Client build must not contain the reserved top-level admin path.'
    }

    foreach ($distRoot in @($clientDist, $adminDist)) {
        $reparsePoint = Get-ChildItem -LiteralPath $distRoot -Force -Recurse |
            Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint } |
            Select-Object -First 1
        if ($null -ne $reparsePoint) {
            throw "Build output contains a forbidden reparse point: $($reparsePoint.FullName)"
        }
    }

    $siteRoot = Join-Path $stageRoot 'site\openBMB'
    $adminSiteRoot = Join-Path $siteRoot 'admin'
    [System.IO.Directory]::CreateDirectory($siteRoot) | Out-Null
    Get-ChildItem -LiteralPath $clientDist -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $siteRoot -Recurse -Force
    }
    [System.IO.Directory]::CreateDirectory($adminSiteRoot) | Out-Null
    Get-ChildItem -LiteralPath $adminDist -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $adminSiteRoot -Recurse -Force
    }

    $siteFiles = [System.Collections.Generic.List[string]]::new()
    Get-ChildItem -LiteralPath (Join-Path $stageRoot 'site') -File -Force -Recurse |
        ForEach-Object {
            $relativePath = Get-StagedRelativePath `
                -BasePath $stageRoot `
                -ChildPath $_.FullName
            Assert-SafeArtifactPath -RelativePath $relativePath
            if ($relativePath.Contains("`n") -or $relativePath.Contains("`r")) {
                throw "Newlines are not allowed in artifact paths: $relativePath"
            }
            $siteFiles.Add($relativePath)
        }
    $siteFiles.Sort([System.StringComparer]::Ordinal)
    if ($siteFiles.Count -eq 0) {
        throw 'The staged web artifact is empty.'
    }
    [Int64] $expandedBytes = 0
    foreach ($relativePath in $siteFiles) {
        $nativeRelativePath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $expandedBytes += (Get-Item -LiteralPath (Join-Path $stageRoot $nativeRelativePath)).Length
    }
    if ($expandedBytes -le 0) {
        throw 'Unable to measure the expanded Web payload.'
    }

    $checksumLines = foreach ($relativePath in $siteFiles) {
        $nativeRelativePath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $hash = Get-Sha256Hex -LiteralPath (Join-Path $stageRoot $nativeRelativePath)
        "$hash  $relativePath"
    }
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    $checksumPath = Join-Path $stageRoot 'SHA256SUMS'
    [System.IO.File]::WriteAllText(
        $checksumPath,
        (($checksumLines -join "`n") + "`n"),
        $utf8WithoutBom
    )

    $epoch = [DateTime]::SpecifyKind([DateTime]'1970-01-01T00:00:00', [DateTimeKind]::Utc)
    Get-ChildItem -LiteralPath $stageRoot -Force -Recurse | ForEach-Object {
        $_.LastWriteTimeUtc = $epoch
        $_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::ReadOnly
    }

    $archiveList = [System.Collections.Generic.List[string]]::new()
    $archiveList.Add('SHA256SUMS')
    Get-ChildItem -LiteralPath (Join-Path $stageRoot 'site') -Force -Recurse |
        ForEach-Object {
            $relativePath = Get-StagedRelativePath `
                -BasePath $stageRoot `
                -ChildPath $_.FullName
            Assert-SafeArtifactPath -RelativePath $relativePath
            $archiveList.Add($relativePath)
        }
    $archiveList.Add('site')
    $archiveList.Sort([System.StringComparer]::Ordinal)
    $archiveListPath = Join-Path $evidenceRoot 'archive-files.txt'
    [System.IO.File]::WriteAllText(
        $archiveListPath,
        (($archiveList -join "`n") + "`n"),
        $utf8WithoutBom
    )

    $archivePath = Join-Path $evidenceRoot "openbmb-web-$headCommit.tar.zst"
    if (Test-Path -LiteralPath $archivePath) {
        throw "Refusing to overwrite existing archive evidence: $archivePath"
    }
    Invoke-CheckedCommand -FilePath $tarPath -ArgumentList @(
        '-c', '--zstd', '--format', 'ustar', '--no-recursion',
        '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root',
        '--options', 'zstd:compression-level=19',
        '-f', $archivePath, '-C', $stageRoot, '-T', $archiveListPath
    )
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf) -or
        (Get-Item -LiteralPath $archivePath).Length -le 0) {
        throw 'bsdtar did not create a non-empty archive.'
    }

    $verificationRoot = Join-Path $evidenceRoot 'verify'
    if (Test-Path -LiteralPath $verificationRoot) {
        throw "Refusing to overwrite existing verification evidence: $verificationRoot"
    }
    [System.IO.Directory]::CreateDirectory($verificationRoot) | Out-Null
    Invoke-CheckedCommand -FilePath $tarPath -ArgumentList @(
        '-x', '--zstd', '-f', $archivePath, '-C', $verificationRoot
    )
    $verificationRoots = @(
        Get-ChildItem -LiteralPath $verificationRoot -Force |
            Select-Object -ExpandProperty Name |
            Sort-Object
    )
    if (($verificationRoots -join '|') -cne 'SHA256SUMS|site') {
        throw "Archive root contract failed: $($verificationRoots -join '|')"
    }
    $verifiedChecksumLines = [System.IO.File]::ReadAllLines(
        (Join-Path $verificationRoot 'SHA256SUMS'),
        $utf8WithoutBom
    )
    if (($verifiedChecksumLines -join "`n") -cne ($checksumLines -join "`n")) {
        throw 'The archived SHA256SUMS differs from the staged manifest.'
    }
    foreach ($relativePath in $siteFiles) {
        $nativeRelativePath = $relativePath.Replace(
            '/',
            [System.IO.Path]::DirectorySeparatorChar
        )
        $verifiedPath = Join-Path $verificationRoot $nativeRelativePath
        if (-not (Test-Path -LiteralPath $verifiedPath -PathType Leaf)) {
            throw "Archive is missing a manifest file: $relativePath"
        }
        $expectedLine = $checksumLines[$siteFiles.IndexOf($relativePath)]
        $expectedHash = $expectedLine.Substring(0, 64)
        $verifiedHash = Get-Sha256Hex -LiteralPath $verifiedPath
        if ($verifiedHash -cne $expectedHash) {
            throw "Archived file checksum failed: $relativePath"
        }
    }
    $verifiedFileCount = @(
        Get-ChildItem -LiteralPath (Join-Path $verificationRoot 'site') `
            -File -Force -Recurse
    ).Count
    if ($verifiedFileCount -ne $siteFiles.Count) {
        throw 'Archive contains files not covered by SHA256SUMS.'
    }

    $archiveSha256 = Get-Sha256Hex -LiteralPath $archivePath
    if ($archiveSha256 -notmatch '^[0-9a-f]{64}$') {
        throw 'Unable to calculate a normalized archive SHA-256.'
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $evidenceRoot 'archive.sha256'),
        "$archiveSha256  $([System.IO.Path]::GetFileName($archivePath))`n",
        $utf8WithoutBom
    )

    $finalHead = (& $gitPath -C $projectRoot rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $finalHead -ne $headCommit) {
        throw "Repository HEAD changed before Web transfer: expected $headCommit, got $finalHead"
    }
    $finalDirtyStatus = (& $gitPath -C $projectRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $finalDirtyStatus) {
        throw 'Refusing to transfer because the worktree is no longer clean.'
    }

    $uploadNonce = [System.Guid]::NewGuid().ToString('N')
    $remoteArchivePath = "$remoteDirectory/openbmb-web-$headCommit-$archiveSha256-$uploadNonce.tar.zst"
    [Int64] $archiveBytes = (Get-Item -LiteralPath $archivePath).Length
    [Int64] $promotionRequiredBytes = $expandedBytes + $archiveBytes + 1073741824
    [Int64] $uploadRequiredBytes = $promotionRequiredBytes + $archiveBytes
    Invoke-CheckedCommandWithInput `
        -InputText $prepareIncomingScript `
        -FilePath $sshPath `
        -ArgumentList ($sshOptions + @(
            $SshHost, 'bash', '-s', '--', 'web', $remoteDirectory,
            $remoteArchivePath, $uploadRequiredBytes.ToString()
        ))
    Invoke-CheckedCommandWithInput `
        -InputText $promotionGuardScript `
        -FilePath $sshPath `
        -ArgumentList ($sshOptions + @(
            $SshHost, 'sudo', '-n', 'bash', '-s', '--', 'upload-preflight',
            'web', $uploadRequiredBytes.ToString()
        ))
    $remoteUploadAttempted = $true
    Invoke-CheckedCommand -FilePath $scpPath -ArgumentList @(
        $sshOptions + @($archivePath, "${SshHost}:$remoteArchivePath")
    )

    $remoteMainLines = @(
        & $gitPath -C $projectRoot ls-remote --exit-code --refs origin refs/heads/main
    )
    if ($LASTEXITCODE -ne 0 -or $remoteMainLines.Count -ne 1) {
        throw 'Unable to resolve exactly one current origin/main ref before promotion.'
    }
    $remoteMainFields = @($remoteMainLines[0].Trim() -split '\s+')
    if ($remoteMainFields.Count -ne 2 -or
        $remoteMainFields[0].ToLowerInvariant() -ne $headCommit -or
        $remoteMainFields[1] -cne 'refs/heads/main') {
        throw "Refusing stale Web promotion: validated=$headCommit remote=$($remoteMainFields[0])"
    }

    Invoke-CheckedCommandWithInput `
        -InputText $promotionGuardScript `
        -FilePath $sshPath `
        -ArgumentList ($sshOptions + @(
            $SshHost, 'sudo', '-n', 'bash', '-s', '--', 'web', $headCommit,
            $remoteArchivePath, $archiveSha256, $promotionRequiredBytes.ToString()
        ))

    Write-Host "Published web commit $headCommit"
    Write-Host "Archive SHA-256: $archiveSha256"
    Write-Host "Local evidence retained at: $evidenceRoot"
}
catch {
    Write-Warning "Web publication failed. Local evidence was retained at: $evidenceRoot"
    throw
}
finally {
    if ($remoteArchivePath -and $remoteUploadAttempted) {
        $cleanupCommand = "set -eu; test `"`$(dirname -- '$remoteArchivePath')`" = '$remoteDirectory'; if test -e '$remoteArchivePath' || test -L '$remoteArchivePath'; then test -f '$remoteArchivePath'; test ! -L '$remoteArchivePath'; rm -f -- '$remoteArchivePath'; fi"
        $previousErrorActionPreference = $ErrorActionPreference
        $cleanupExitCode = 1
        try {
            $ErrorActionPreference = 'SilentlyContinue'
            & $sshPath @sshOptions $SshHost $cleanupCommand 2>$null
            $cleanupExitCode = $LASTEXITCODE
        }
        catch {
            $cleanupExitCode = 1
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($cleanupExitCode -ne 0) {
            Write-Warning "Unable to remove the exact remote incoming file: $remoteArchivePath"
        }
    }
}
