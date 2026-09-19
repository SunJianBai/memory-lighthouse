param([ValidateSet('Check', 'Preview')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
if (-not $env:TODAY_CARE_MYSQL_TEST_URL) { throw 'Set TODAY_CARE_MYSQL_TEST_URL for the isolated MySQL fixture first.' }
$testDb = [Uri]$env:TODAY_CARE_MYSQL_TEST_URL
if ($testDb.Scheme -ne 'mysql' -or $testDb.Host -ne '127.0.0.1' -or $testDb.Port -ne 13306 -or $testDb.AbsolutePath -ne '/lighthouse_iteration_test') {
    throw 'Only mysql://127.0.0.1:13306/lighthouse_iteration_test is allowed.'
}
$env:NODE_ENV = 'test'
$env:DATABASE_URL = $env:TODAY_CARE_MYSQL_TEST_URL
$env:MAIL_DELIVERY_MODE = 'memory'
$env:PUBLIC_APP_URL = 'http://127.0.0.1:4310/openBMB'
$env:CORS_ORIGINS = 'http://127.0.0.1:4310,http://localhost:4310'
$env:CARE_WORKFLOW_SCHEDULER_ENABLED = 'false'
$env:TRANSCRIPT_PURGE_ENABLED = 'false'
$env:REMOTE_SESSION_EXPIRY_ENABLED = 'false'
$env:ASSET_LIFECYCLE_WORKER_ENABLED = 'false'
# Constructor configuration only; these unrelated transports are not exercised.
$env:LIVEKIT_URL = 'ws://127.0.0.1:17880'
$env:LIVEKIT_PUBLIC_URL = $env:LIVEKIT_URL
$env:LIVEKIT_API_KEY = 'local-care-fixture'
$env:LIVEKIT_API_SECRET = 'local-care-fixture-not-production'
$env:OBJECT_STORAGE_ENDPOINT = 'http://127.0.0.1:19000'
$env:OBJECT_STORAGE_REGION = 'us-east-1'
$env:OBJECT_STORAGE_BUCKET = 'local-care-fixture'
$env:OBJECT_STORAGE_ACCESS_KEY_ID = 'local-care-fixture'
$env:OBJECT_STORAGE_SECRET_ACCESS_KEY = 'local-care-fixture-not-production'
$env:OBJECT_STORAGE_FORCE_PATH_STYLE = 'true'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    if ($Mode -eq 'Preview') {
        $env:TS_NODE_TRANSPILE_ONLY = 'true'
        node -r ts-node/register scripts/today-care-preview.ts
    } else {
        node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand
    }
    if ($LASTEXITCODE -ne 0) { throw "Local care $Mode failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }
