# Full Microsoft Store build for Digital Habits: To-Do (CI-friendly PowerShell).
#
# 1. Compile Tauri (unsigned — Partner Center re-signs the MSIX on upload)
# 2. Bundle NSIS/MSI with webviewInstallMode "skip"
# 3. Package MSIX with makeappx
#
# Prerequisites (Windows):
#   - Node 20+, Rust target, Windows SDK (makeappx)
#   - WINDOWS_IDENTITY_NAME, WINDOWS_PUBLISHER, WINDOWS_PUBLISHER_DISPLAY_NAME
#     (env or .env)
#   - Optional until Google Tasks ships: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
#     (env or .env; baked into the binary at compile time via build.rs)
#   - assets/1024x1024.png for MSIX assets
#
# Output:
#   for-distribution/x86_64-pc-windows-msvc/Digital-Habits-To-Do_<version>.0_x64.msix
#
# Usage:
#   .\scripts\build-win-store.ps1
#   .\scripts\build-win-store.ps1 -x64Only

param(
    [switch]$x64Only,
    [switch]$arm64Only
)

$ErrorActionPreference = "Stop"

Write-Host "=== Digital Habits: To-Do Windows Build (Microsoft Store) ===" -ForegroundColor Cyan
Write-Host ""

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StoreConfig = "src-tauri/tauri.microsoftstore.conf.json"
$TargetX64 = "x86_64-pc-windows-msvc"
$TargetArm64 = "aarch64-pc-windows-msvc"

$envFile = Join-Path $ProjectRoot ".env"
if (Test-Path $envFile) {
    Write-Host "  Loading environment variables from .env..." -ForegroundColor Gray
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $value = $parts[1].Trim().Trim('"').Trim("'")
                [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
    Write-Host ""
}

Write-Host "  Code signing: skipped (Partner Center re-signs the MSIX)." -ForegroundColor Gray
Write-Host ""

if (-not $env:WINDOWS_IDENTITY_NAME -or -not $env:WINDOWS_PUBLISHER) {
    Write-Host "  ERROR: Set WINDOWS_IDENTITY_NAME and WINDOWS_PUBLISHER (.env or CI secrets)." -ForegroundColor Red
    exit 1
}

# Default: x64 only (npm run build:win historically). Pass neither switch for x64;
# use -arm64Only for arm64, or omit -x64Only and add both by not passing -x64Only
# when we later want dual-arch — for now both flags off means x64 only.
$buildX64 = -not $arm64Only
$buildArm64 = $arm64Only -and -not $x64Only
if (-not $x64Only -and -not $arm64Only) {
    $buildX64 = $true
    $buildArm64 = $false
}
if ($x64Only) {
    $buildX64 = $true
    $buildArm64 = $false
}

$env:WINDOWS_STORE = "1"

function Invoke-TauriStoreBuild {
    param([string]$Target)

    Push-Location $ProjectRoot

    Write-Host "  Compiling ($Target)..." -ForegroundColor Gray
    npx tauri build --target $Target --no-bundle
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }

    Write-Host "  Bundling NSIS/MSI ($Target)..." -ForegroundColor Gray
    npx tauri bundle --target $Target --bundles nsis,msi --config $StoreConfig
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }

    Pop-Location

    node (Join-Path $ProjectRoot "scripts\collect-distribution-artifacts.js") --target $Target
    if ($LASTEXITCODE -ne 0) { exit 1 }

    $arch = if ($Target -eq $TargetArm64) { "arm64" } else { "x64" }
    & (Join-Path $ProjectRoot "scripts\build-msix.ps1") -Architecture $arch
    if ($LASTEXITCODE -ne 0) { exit 1 }

    node (Join-Path $ProjectRoot "scripts\verify-windows-store-artifacts.js") $Target
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

if ($buildX64) {
    Write-Host "Building x64 for Microsoft Store..." -ForegroundColor Yellow
    Write-Host ""
    Invoke-TauriStoreBuild -Target $TargetX64
    Write-Host ""
}

if ($buildArm64) {
    Write-Host "Building ARM64 for Microsoft Store..." -ForegroundColor Yellow
    Write-Host ""
    Invoke-TauriStoreBuild -Target $TargetArm64
    Write-Host ""
}

Write-Host "=== Store build complete ===" -ForegroundColor Green
Write-Host "  Submit the .msix from for-distribution/<target-triple>/ in Partner Center." -ForegroundColor Gray
Write-Host ""
