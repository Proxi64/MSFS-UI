#requires -Version 7
<#
.SYNOPSIS
  Builds wasm/dist/msfs-ui.wasm with the MSFS 2024 SDK ($env:MSFS2024_SDK), checks it, and runs the tests.
.PARAMETER NoTest
  Skips the Node tests (the import / export / path checks still run).
#>
param([switch]$NoTest)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $env:MSFS2024_SDK) { throw 'MSFS2024_SDK is not set: install the MSFS 2024 SDK.' }
$wasm = Join-Path $env:MSFS2024_SDK 'WASM'
$sysroot = Join-Path $wasm 'wasi-sysroot'
$obj = Join-Path $here 'obj'
$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force $obj, $dist | Out-Null
Get-ChildItem $obj -Filter *.o | Remove-Item

# The command verified in the sim (.claude/skills/msfs-wasm/reference.md). clang-cl runs in gcc mode: with a wasm target
# its MSVC-style flags are ignored. The SDK's headers are C++ (default member initialisers), hence .cpp sources.
$objects = @()
foreach ($source in Get-ChildItem (Join-Path $here 'src') -Filter *.cpp) {
  $object = Join-Path $obj ($source.BaseName + '.o')
  & "$wasm\llvm\bin\clang-cl.exe" --driver-mode=g++ --target=wasm32-unknown-wasi "--sysroot=$sysroot" -c -O2 -std=c++17 `
    -fno-exceptions -fno-rtti -fno-stack-protector -fvisibility=hidden -mbulk-memory -fstack-size-section `
    -D_MSFS_WASM -D__wasi__ -D_LIBCPP_HAS_NO_THREADS -D_STRING_H_CPLUSPLUS_98_CONFORMANCE_ -D_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_ `
    -I "$wasm\include" $source.FullName -o $object
  if ($LASTEXITCODE -ne 0) { throw "compile of $($source.Name) failed ($LASTEXITCODE)" }
  $objects += $object
}

$output = Join-Path $dist 'msfs-ui.wasm'
& "$wasm\llvm\bin\wasm-ld.exe" --no-entry --allow-undefined --export-table --stack-guard-page --strip-debug --no-eac-patch `
  --export=__wasm_call_ctors --export=module_init --export=module_deinit `
  --export=malloc --export=free --export=mallinfo --export=mchunkit_begin --export=mchunkit_next `
  --export=get_pages_state --export=mark_decommit_pages `
  -L "$sysroot\lib\wasm32-wasi" -lc "$sysroot\lib\wasm32-wasi\libclang_rt.builtins-wasm32.a" `
  $objects -o $output
if ($LASTEXITCODE -ne 0) { throw "link failed ($LASTEXITCODE)" }

& node (Join-Path $here 'check-module.cjs') $output $env:USERPROFILE $env:USERNAME
if ($LASTEXITCODE -ne 0) { throw 'the module failed its checks' }
Write-Host "built $output ($((Get-Item $output).Length) bytes)"

if (-not $NoTest) {
  Push-Location (Split-Path $here)
  try {
    & node --test "wasm/test/*.test.ts"
    if ($LASTEXITCODE -ne 0) { throw 'the tests failed' }
  } finally {
    Pop-Location
  }
}
