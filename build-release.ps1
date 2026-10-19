# Builds the release of MSFS-UI-GENERATOR:
#   release\MSFS-UI-GENERATOR\                  the self-contained app (no .NET, Windows App SDK or Node to install),
#                                               with LICENSE.txt
#   release\MSFS-UI-GENERATOR-<version>.zip     the same folder, zipped
# Steps: the mod in release mode (checks, tests, no source map), every .NET test (UI tests included, unless
# -SkipUiTests), the app published in Release, a check that no path of this machine is in it, the zip. It stops at
# the first failure.
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

$filter = $SkipUiTests ? @('--filter', 'TestCategory!=UI') : @()
# The whole solution first: the UI tests run the built app, which the test projects do not reference.
Invoke-Step 'App: build' { dotnet build generator\MsfsUi.slnx -c Release }
Invoke-Step 'App: tests' { dotnet test generator\MsfsUi.slnx -c Release --no-build @filter }

if (Test-Path $folder) { Remove-Item $folder -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
Invoke-Step 'App: publish' {
  dotnet publish generator\MsfsUi.App\MsfsUi.App.csproj -c Release -p:PublishProfile=win-x64 -o $folder
}
$exe = Join-Path $folder 'MSFS-UI-GENERATOR.exe'
if (-not (Test-Path $exe)) { throw "$exe is missing from the published folder." }
# The licence goes with the app (.txt: opened by a double click on Windows).
Copy-Item LICENSE (Join-Path $folder 'LICENSE.txt')

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
Write-Host "Done: $folder ($($files.Count) files, $([Math]::Round($size / 1MB)) MB)" -ForegroundColor Green
Write-Host "      $zip ($([Math]::Round((Get-Item $zip).Length / 1MB)) MB)" -ForegroundColor Green
