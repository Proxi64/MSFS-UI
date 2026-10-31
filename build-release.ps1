# Builds the release of MSFS-UI-GENERATOR:
#   release\MSFS-UI-GENERATOR\                  MSFS-UI-GENERATOR.exe (a native launcher), LICENSE.txt and app\, the
#                                               self-contained app (no .NET, Windows App SDK or Node to install)
#   release\MSFS-UI-GENERATOR-<version>.zip     the same folder, zipped
# Steps: the mod in release mode (checks, tests, no source map), every .NET test (UI tests included, unless
# -SkipUiTests), the app published in Release into app\, the launcher (NativeAOT, needs Visual Studio's C++ tools),
# a check that the launcher starts the app, a check that no path of this machine is in the folder, the zip. It stops
# at the first failure.
#   pwsh -File build-release.ps1 [-SkipUiTests]
param([switch]$SkipUiTests)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Invoke-Step([string]$name, [scriptblock]$action) {
  Write-Host "=== $name ===" -ForegroundColor Cyan
  & $action
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit code $LASTEXITCODE)." }
}

# The app's version follows the mod's (generator\Directory.Build.props and mod\features.json).
$version = (Get-Content mod\features.json -Raw | ConvertFrom-Json).modVersion
$appVersion = ([xml](Get-Content generator\Directory.Build.props -Raw)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if ($appVersion -ne $version) { throw "The app version ($appVersion, generator\Directory.Build.props) differs from the mod version ($version, mod\features.json)." }
Write-Host "MSFS-UI-GENERATOR $version"

$release = Join-Path $PSScriptRoot 'release'
$folder = Join-Path $release 'MSFS-UI-GENERATOR'
$zip = Join-Path $release "MSFS-UI-GENERATOR-$version.zip"

Push-Location mod
try {
  Invoke-Step 'Mod: dependencies' { npm ci --no-audit --no-fund }
  Invoke-Step 'Mod: checks, build and tests' { npm run check }
  # Last: the module the app embeds, without the source map.
  Invoke-Step 'Mod: release module' { node build/build.ts --release }
}
finally {
  Pop-Location
}

Invoke-Step 'Vault module: build and tests' { pwsh -File wasm\build.ps1 }

$filter = $SkipUiTests ? @('--filter', 'TestCategory!=UI') : @()
# The whole solution first: the UI tests run the built app, which the test projects do not reference.
Invoke-Step 'App: build' { dotnet build generator\MsfsUi.slnx -c Release }
Invoke-Step 'App: tests' { dotnet test generator\MsfsUi.slnx -c Release --no-build @filter }

if (Test-Path $folder) { Remove-Item $folder -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
# The app and its hundreds of files in app\, the launcher alone at the top (the owner's choice, 2.0.3).
$appFolder = Join-Path $folder 'app'
Invoke-Step 'App: publish' {
  dotnet publish generator\MsfsUi.App\MsfsUi.App.csproj -c Release -p:PublishProfile=win-x64 -o $appFolder
}
# NativeAOT links with Visual Studio's C++ tools, found through vswhere, which is not always on the PATH.
$vsInstaller = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
if (Test-Path $vsInstaller) { $env:PATH = "$vsInstaller;$env:PATH" }
Invoke-Step 'Launcher: publish' {
  dotnet publish generator\MsfsUi.Launcher\MsfsUi.Launcher.csproj -c Release -o $folder
}
$exe = Join-Path $folder 'MSFS-UI-GENERATOR.exe'
$appExe = Join-Path $appFolder 'MSFS-UI-GENERATOR.exe'
foreach ($file in $exe, $appExe) { if (-not (Test-Path $file)) { throw "$file is missing from the published folder." } }
# The licence goes with the app (.txt: opened by a double click on Windows).
Copy-Item LICENSE (Join-Path $folder 'LICENSE.txt')

# The launcher starts the app from app\: on an isolated profile, as the UI tests (a data folder of its own, an
# inspector port where nothing answers: the real sim and data are never reached); its window, then closed.
Write-Host '=== Release: the launcher starts the app ===' -ForegroundColor Cyan
$smokeData = Join-Path ([IO.Path]::GetTempPath()) "msfs-ui-release-smoke-$PID"
$env:MSFS_UI_DATA_ROOT = $smokeData
$env:MSFS_UI_INSPECTOR_HOST = '127.0.0.1:9'
try {
  $launcher = Start-Process $exe -WorkingDirectory $folder -PassThru
  if (-not $launcher.WaitForExit(10000) -or $launcher.ExitCode -ne 0) { throw "The launcher did not end with code 0 within 10 s." }
  $app = $null
  for ($i = 0; $i -lt 60 -and -not $app; $i++) {
    Start-Sleep -Milliseconds 500
    $app = Get-Process 'MSFS-UI-GENERATOR' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $appExe -and $_.MainWindowHandle -ne 0 }
  }
  if (-not $app) { throw "The launcher did not start $appExe (no window within 30 s)." }
  $app | Stop-Process -Force
}
finally {
  Remove-Item Env:MSFS_UI_DATA_ROOT, Env:MSFS_UI_INSPECTOR_HOST -ErrorAction SilentlyContinue
  Remove-Item $smokeData -Recurse -Force -ErrorAction SilentlyContinue
}

# No path of the build machine in the release (the user's folder would show the user's name): the paths are mapped
# at compile time (generator\Directory.Build.targets); this checks it, in text and UTF-16.
Write-Host '=== Release: no path of this machine ===' -ForegroundColor Cyan
$profilePath = [Environment]::GetFolderPath('UserProfile')
$leaks = Get-ChildItem $folder -Recurse -File | Where-Object {
  $bytes = [IO.File]::ReadAllBytes($_.FullName)
  [Text.Encoding]::Latin1.GetString($bytes).IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
  [Text.Encoding]::Unicode.GetString($bytes).IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0
}
if ($leaks) { throw "The release holds the path of the user's folder in: $(($leaks | ForEach-Object Name) -join ', ')." }

Write-Host '=== Zip ===' -ForegroundColor Cyan
Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel Optimal

$files = Get-ChildItem $folder -Recurse -File
$size = ($files | Measure-Object Length -Sum).Sum
Write-Host ''
Write-Host "Done: $folder ($((Get-ChildItem $folder).Count) items at the top; $($files.Count) files, $([Math]::Round($size / 1MB)) MB)" -ForegroundColor Green
Write-Host "      $zip ($([Math]::Round((Get-Item $zip).Length / 1MB)) MB)" -ForegroundColor Green
