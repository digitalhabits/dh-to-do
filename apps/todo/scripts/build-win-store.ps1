# Build Digital Habits: To-Do as an MSIX, for the Microsoft Store.
#
#   pnpm --dir apps/todo app:build:win-store
#   pnpm --dir apps/todo app:build:win-store -x64Only
#
# Run it on Windows, from PowerShell. It needs Node, pnpm, Rust with the
# x86_64-pc-windows-msvc and aarch64-pc-windows-msvc targets, the Visual Studio
# C++ build tools, and the Windows SDK for makeappx.exe.
#
# What comes out: apps/todo/for-distribution/*.msix, one for each
# architecture. Upload them by hand under Packages in Partner Center.
#
# Nothing is signed here. Microsoft signs the package again when it takes it
# in, so the compile stops before the bundler (--no-bundle) and never reaches
# a signing step. There is no WebView2 bootstrapper: the Store handles that.
#
# To-Do goes out through the stores only, so this is the one Windows build
# there is. 2.x also made an NSIS installer for a direct download. 3.x does
# not.
#
# The packaging steps are the ones Mail's script uses, which are proven. What
# is To-Do's own is the identity, the names, the executable and the icons.
#
# Packages. This script never submits anything.

param(
    [switch]$x64Only,
    [switch]$arm64Only,
    # Package what is already compiled. Useful when only the manifest changed.
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path $PSScriptRoot -Parent
Push-Location $AppRoot

try {
    Write-Host '=== Digital Habits To-Do - Microsoft Store package ===' -ForegroundColor Cyan
    Write-Host ''

    $envFile = Join-Path $AppRoot '.env.local'
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#')) {
                $parts = $line -split '=', 2
                if ($parts.Length -eq 2) {
                    [System.Environment]::SetEnvironmentVariable(
                        $parts[0].Trim(), $parts[1].Trim().Trim('"').Trim("'"), 'Process')
                }
            }
        }
    }

    # The identity that Partner Center gave To-Do 2.x, and 3.x must have the
    # same one: a package with another identity is another product, and the
    # people who have 2.x get no update. None of the three is a secret. Each
    # is in the manifest of every package that ships.
    #
    # The publisher GUID is the seller account, so it is the same as Mail's
    # and Blocker's. The identity name is this product's alone. The display
    # name is the one 2.x was listed under, and the upload is refused if it
    # does not match the product in Partner Center.
    $identityName = if ($env:WINDOWS_IDENTITY_NAME) { $env:WINDOWS_IDENTITY_NAME }
                    else { 'ReduceDigitalDistraction.ReDDTodo' }
    $publisher = if ($env:WINDOWS_PUBLISHER) { $env:WINDOWS_PUBLISHER }
                 else { 'CN=EC16037E-D0B5-446F-9912-F41B3DCCBFB3' }
    $publisherDisplayName = if ($env:WINDOWS_PUBLISHER_DISPLAY_NAME) { $env:WINDOWS_PUBLISHER_DISPLAY_NAME }
                            else { 'Reduce Digital Distraction' }

    $version = (Get-Content (Join-Path $AppRoot 'package.json') | ConvertFrom-Json).version
    # The Store wants four parts, and reserves the last for itself.
    $msixVersion = "$version.0"
    Write-Host "  Digital Habits: To-Do $msixVersion" -ForegroundColor White
    Write-Host "  Identity  $identityName" -ForegroundColor Gray
    Write-Host "  Publisher $publisher" -ForegroundColor Gray
    Write-Host '  Signing   none - Partner Center re-signs on upload.' -ForegroundColor Gray
    Write-Host ''

    $makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $makeappx) {
        Write-Host '  ERROR: makeappx.exe not found. Install the Windows SDK.' -ForegroundColor Red
        exit 1
    }

    $targets = @()
    if (-not $arm64Only) { $targets += 'x86_64-pc-windows-msvc' }
    if (-not $x64Only) { $targets += 'aarch64-pc-windows-msvc' }

    $distDir = Join-Path $AppRoot 'for-distribution'
    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

    foreach ($target in $targets) {
        $arch = if ($target -like 'aarch64*') { 'arm64' } else { 'x64' }
        Write-Host ''
        Write-Host "Packaging $arch..." -ForegroundColor Yellow

        if (-not $SkipBuild) {
            rustup target add $target | Out-Null
            # --no-bundle: the compiled exe is all this needs. It also means the
            # bundler never runs, so nothing here is signed. Tauri builds the
            # page first (beforeBuildCommand), so there is no separate step.
            pnpm tauri build --target $target --no-bundle
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }

        $exe = Join-Path $AppRoot "src-tauri\target\$target\release\digital-habits-todo.exe"
        if (-not (Test-Path $exe)) {
            Write-Host "  ERROR: nothing compiled at $exe" -ForegroundColor Red
            Write-Host '  Run without -SkipBuild.' -ForegroundColor Yellow
            exit 1
        }

        $staging = Join-Path $AppRoot "msix-build\$arch"
        if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        $assets = Join-Path $staging 'Assets'
        New-Item -ItemType Directory -Path $assets | Out-Null

        # Every logo the manifest names already exists at exactly the right
        # size: `tauri icon` generated the Square*Logo set for Windows when it
        # made the .icns and the .ico. So this renames rather than resizes, and
        # needs no image library.
        #
        # Only scale-100 assets, so Windows scales the tile itself on a
        # high-DPI display. Adding scale-200 and scale-400 means generating
        # 300px and 600px versions from a source bigger than the 512px icon.png
        # - worth doing if the tile ever looks soft, not worth it before then.
        Write-Host '  [1/4] Icon assets...' -ForegroundColor Gray
        $iconDir = Join-Path $AppRoot 'src-tauri\icons'
        $logos = @{
            'StoreLogo.png'          = 'StoreLogo.scale-100.png'
            'Square44x44Logo.png'    = 'Square44x44Logo.scale-100.png'
            'Square150x150Logo.png'  = 'Square150x150Logo.scale-100.png'
            'Square71x71Logo.png'    = 'SmallTile.scale-100.png'
            'Square310x310Logo.png'  = 'LargeTile.scale-100.png'
        }
        foreach ($from in $logos.Keys) {
            $source = Join-Path $iconDir $from
            if (-not (Test-Path $source)) {
                Write-Host "  ERROR: missing icon $source" -ForegroundColor Red
                Write-Host '  Regenerate with: pnpm tauri icon' -ForegroundColor Yellow
                exit 1
            }
            Copy-Item $source (Join-Path $assets $logos[$from])
        }

        Write-Host '  [2/4] AppxManifest.xml...' -ForegroundColor Gray
        $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="$identityName"
    Publisher="$publisher"
    Version="$msixVersion"
    ProcessorArchitecture="$arch" />

  <Properties>
    <DisplayName>Digital Habits: To-Do</DisplayName>
    <PublisherDisplayName>$publisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.scale-100.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Applications>
    <Application Id="App" Executable="digital-habits-todo.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Digital Habits: To-Do"
        Description="Keep your goals in sight and get back to what you wanted to do."
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.scale-100.png"
        Square44x44Logo="Assets\Square44x44Logo.scale-100.png">
        <uap:DefaultTile Square71x71Logo="Assets\SmallTile.scale-100.png" Square310x310Logo="Assets\LargeTile.scale-100.png" />
        <uap:SplashScreen Image="Assets\Square150x150Logo.scale-100.png" />
      </uap:VisualElements>
    </Application>
  </Applications>

  <!-- runFullTrust and nothing else, as in 2.x. The board is a SQLite file
       in the app's own data directory, and the Basecamp sign-in comes back
       through a listener on localhost, which runFullTrust leaves alone. -->
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
        # No BOM: makeappx rejects one.
        [System.IO.File]::WriteAllText(
            (Join-Path $staging 'AppxManifest.xml'),
            $manifest,
            (New-Object System.Text.UTF8Encoding $false))

        Write-Host '  [3/4] Staging...' -ForegroundColor Gray
        Copy-Item $exe $staging
        # Present only when WebView2 is linked dynamically. Harmless either way.
        $loader = Join-Path $AppRoot "src-tauri\target\$target\release\WebView2Loader.dll"
        if (Test-Path $loader) { Copy-Item $loader $staging }

        Write-Host '  [4/4] makeappx...' -ForegroundColor Gray
        $msix = Join-Path $distDir "Digital-Habits-To-Do_${msixVersion}_${arch}.msix"
        & $makeappx.FullName pack /d $staging /p $msix /o
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  ERROR: makeappx failed.' -ForegroundColor Red
            exit $LASTEXITCODE
        }
        Write-Host "  $msix" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Upload these under Packages in Partner Center. Microsoft signs them there.' -ForegroundColor Yellow
    Write-Host 'The identity must match Product identity in Partner Center exactly, or the' -ForegroundColor Yellow
    Write-Host 'upload is refused.' -ForegroundColor Yellow
    Write-Host ''
}
finally {
    Pop-Location
}
