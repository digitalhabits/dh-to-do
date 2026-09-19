# Submit Store MSIX packages to Partner Center via msstore CLI.
#
# Prerequisites:
#   - msstore on PATH (e.g. microsoft/microsoft-store-apppublisher action)
#   - AZURE_AD_TENANT_ID, AZURE_AD_APPLICATION_CLIENT_ID,
#     AZURE_AD_APPLICATION_SECRET, SELLER_ID configured via `msstore reconfigure`
#     (caller does reconfigure) OR pass -Reconfigure
#   - MS_STORE_PRODUCT_ID (or -ProductId)
#
# Usage:
#   ./scripts/submit-microsoft-store.ps1 `
#     -PackagesDir for-distribution `
#     -WhatsNewFile whats_new.txt `
#     -ProductId 9PXXXXXXXXXX
#
# Flow:
#   1. Bundle .msix into one .msixbundle (makeappx) when needed
#   2. msstore publish -nc  (upload only; publish recreates the draft, so
#      metadata must be applied *after* this step)
#   3. submission get → stamp What's new + listing description + mark
#      superseded packages PendingDelete → submission update
#   4. msstore submission publish  (commit for certification)

param(
    [Parameter(Mandatory = $true)]
    [string]$PackagesDir,

    [Parameter(Mandatory = $true)]
    [string]$WhatsNewFile,

    [string]$ProductId = $env:MS_STORE_PRODUCT_ID,

    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),

    # Long description shared with Mac App Store (store-listing/description.txt).
    [string]$DescriptionFile = "",

    [switch]$Reconfigure
)

$ErrorActionPreference = "Stop"

function Find-MakeAppx {
    $found = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' `
        -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $found) {
        throw 'makeappx.exe not found — Windows SDK missing on this runner.'
    }
    return $found.FullName
}

function Assert-CommandOk([string]$Label) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Label exited with code $LASTEXITCODE"
    }
}

function Get-StoreSubmissionJson([string]$OutPath) {
    $getErr = "$OutPath.err"
    $proc = Start-Process -FilePath 'msstore' `
        -ArgumentList @('submission', 'get', $ProductId) `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $OutPath `
        -RedirectStandardError $getErr
    if ($proc.ExitCode -ne 0) {
        throw "msstore submission get exited with code $($proc.ExitCode)"
    }
}

if (-not $ProductId) {
    throw 'MS_STORE_PRODUCT_ID / -ProductId is required.'
}
if (-not (Test-Path -LiteralPath $PackagesDir)) {
    throw "PackagesDir not found: $PackagesDir"
}
if (-not (Test-Path -LiteralPath $WhatsNewFile)) {
    throw "WhatsNewFile not found: $WhatsNewFile"
}
if (-not $DescriptionFile) {
    $DescriptionFile = Join-Path $ProjectRoot 'store-listing\description.txt'
}
if (-not (Test-Path -LiteralPath $DescriptionFile)) {
    throw "DescriptionFile not found: $DescriptionFile"
}

$msixFiles = @(Get-ChildItem -Path $PackagesDir -Recurse -Filter '*.msix' -File |
    Where-Object { $_.Name -notlike '*.msixbundle' })
if ($msixFiles.Count -eq 0) {
    throw "No .msix packages under $PackagesDir"
}

Write-Host "Found $($msixFiles.Count) MSIX package(s):" -ForegroundColor Cyan
$msixFiles | ForEach-Object { Write-Host "  $($_.FullName)" }

$bundleDir = Join-Path $env:RUNNER_TEMP 'msix-bundle-stage'
if (-not $bundleDir -or $bundleDir -eq 'msix-bundle-stage') {
    $bundleDir = Join-Path ([System.IO.Path]::GetTempPath()) "redd-msix-bundle-$PID"
}
if (Test-Path $bundleDir) { Remove-Item $bundleDir -Recurse -Force }
New-Item -ItemType Directory -Path $bundleDir | Out-Null
foreach ($f in $msixFiles) {
    Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $bundleDir $f.Name)
}

$pkgJsonPath = Join-Path $ProjectRoot 'package.json'
$version = (Get-Content -LiteralPath $pkgJsonPath -Raw | ConvertFrom-Json).version
if (-not $version) { throw "Could not read version from $pkgJsonPath" }
$bundleOut = Join-Path $PackagesDir "Digital-Habits-To-Do_${version}_store.msixbundle"
$bundleFileName = [System.IO.Path]::GetFileName($bundleOut)
$makeappx = Find-MakeAppx
Write-Host "Bundling with $makeappx → $bundleOut" -ForegroundColor Cyan
& $makeappx bundle /d $bundleDir /p $bundleOut /o
Assert-CommandOk 'makeappx bundle'
if (-not (Test-Path -LiteralPath $bundleOut)) {
    throw "Bundle was not created: $bundleOut"
}

if ($Reconfigure) {
    $tenant = $env:AZURE_AD_TENANT_ID
    $seller = ($env:SELLER_ID ?? '').Trim().Trim('"').Trim("'")
    $client = $env:AZURE_AD_APPLICATION_CLIENT_ID
    $secret = $env:AZURE_AD_APPLICATION_SECRET
    if (-not ($tenant -and $seller -and $client -and $secret)) {
        throw 'Reconfigure requires AZURE_AD_TENANT_ID, SELLER_ID, AZURE_AD_APPLICATION_CLIENT_ID, AZURE_AD_APPLICATION_SECRET.'
    }
    # msstore parses --sellerId with Convert.ToInt32 — must be digits only
    # (Partner Center → Account settings → Identifiers → Seller ID).
    # Not the Publisher GUID, Store product ID (9…), or WINDOWS_PUBLISHER CN=.
    if ($seller -notmatch '^\d+$') {
        throw @"
SELLER_ID must be the numeric Partner Center Seller ID (digits only).
Got length=$($seller.Length) (value redacted).
Open Partner Center → Account settings → Identifiers → Seller ID, update the
GitHub secret, then re-run Actions → Store submit only with this release tag.
"@
    }
    Write-Host 'Configuring msstore credentials…' -ForegroundColor Cyan
    msstore reconfigure `
        --tenantId $tenant `
        --sellerId $seller `
        --clientId $client `
        --clientSecret $secret
    Assert-CommandOk 'msstore reconfigure'
}

$env:NO_COLOR = '1'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $rawUi = $Host.UI.RawUI
    $buf = $rawUi.BufferSize
    if ($buf.Width -lt 4096) {
        $buf.Width = 4096
        $rawUi.BufferSize = $buf
    }
} catch {
    # Non-interactive CI hosts may reject buffer resize — repair handles wraps.
}

$submissionJson = Join-Path $env:RUNNER_TEMP 'store-submission.json'
$patchedJson = Join-Path $env:RUNNER_TEMP 'store-submission-patched.json'
if (-not $env:RUNNER_TEMP) {
    $submissionJson = Join-Path ([System.IO.Path]::GetTempPath()) "store-submission-$PID.json"
    $patchedJson = Join-Path ([System.IO.Path]::GetTempPath()) "store-submission-patched-$PID.json"
}

# pathOrUrl must be the package file (.msix / .msixbundle / .msixupload).
# -nc keeps the draft so we can strip superseded packages + stamp What's new
# before committing. (msstore publish recreates the pending submission, so
# metadata applied *before* upload would be discarded.)
Write-Host "Uploading $bundleOut to Store product $ProductId (no commit)…" -ForegroundColor Cyan
msstore publish $bundleOut -id $ProductId -nc
Assert-CommandOk 'msstore publish -nc'

$notesStamped = $false
$packagesCleaned = $false
try {
    Write-Host "Fetching draft submission for $ProductId…" -ForegroundColor Cyan
    Get-StoreSubmissionJson $submissionJson

    $patchScript = Join-Path $ProjectRoot 'scripts\patch-store-release-notes.cjs'
    node $patchScript $submissionJson $WhatsNewFile $patchedJson $bundleFileName --description $DescriptionFile
    Assert-CommandOk 'patch-store-release-notes.cjs'

    $meta = Get-Content -LiteralPath $patchedJson -Raw -Encoding utf8
    Write-Host 'Updating submission (What''s new + description + PendingDelete superseded packages)…' -ForegroundColor Cyan
    # Full update (not updateMetadata) so ApplicationPackages FileStatus is applied.
    msstore submission update $ProductId $meta
    Assert-CommandOk 'msstore submission update'
    $notesStamped = $true
    $packagesCleaned = $true
    Write-Host 'Draft updated: release notes + description stamped; superseded packages PendingDelete.' -ForegroundColor Green
} catch {
    Write-Warning "Draft metadata/package cleanup failed ($_). Committing upload as-is — remove old packages in Partner Center if needed."
    if (Test-Path -LiteralPath $submissionJson) {
        Write-Host '--- head of submission.json ---' -ForegroundColor Yellow
        Get-Content -LiteralPath $submissionJson -TotalCount 30 | Write-Host
    }
}

Write-Host "Committing submission for $ProductId…" -ForegroundColor Cyan
msstore submission publish $ProductId
Assert-CommandOk 'msstore submission publish'

Write-Host "Submitted to Partner Center (certification). notesStamped=$notesStamped packagesCleaned=$packagesCleaned" -ForegroundColor Green
