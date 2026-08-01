param(
  [string]$EnvFile = '.env'
)

$ErrorActionPreference = 'Stop'
$composeDirectory = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $composeDirectory 'compose\compose.yml'
$resolvedEnvFile = if ([IO.Path]::IsPathRooted($EnvFile)) {
  $EnvFile
} else {
  Join-Path (Split-Path -Parent $composeFile) $EnvFile
}

docker compose --env-file $resolvedEnvFile -f $composeFile config --quiet
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker compose --env-file $resolvedEnvFile -f $composeFile up -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$healthContainers = @(
  'openbmb-mysql',
  'openbmb-redis',
  'openbmb-redis-livekit',
  'openbmb-minio',
  'openbmb-livekit'
)

foreach ($container in $healthContainers) {
  $health = $null
  foreach ($attempt in 1..30) {
    $health = docker inspect $container --format '{{json .State.Health}}' |
      ConvertFrom-Json
    if ($health.Status -eq 'healthy' -or $health.Status -eq 'unhealthy') {
      break
    }
    Start-Sleep -Seconds 2
  }
  if ($health.Status -ne 'healthy') {
    throw "$container is $($health.Status), expected healthy"
  }
}

$minioInitExitCode = docker inspect openbmb-minio-init `
  --format '{{.State.ExitCode}}'
if ($minioInitExitCode -ne '0') {
  throw "openbmb-minio-init exited with $minioInitExitCode"
}

foreach ($port in @(13306, 16379, 19000, 19001, 17880)) {
  if (-not (Test-NetConnection 127.0.0.1 -Port $port `
      -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw "127.0.0.1:$port is not reachable"
  }
}

Write-Output 'OpenBMB local infrastructure is healthy.'
