param([string]$Out)
# Captures the sim's window (its client area) to a PNG with PrintWindow (PW_RENDERFULLCONTENT: DirectX content too,
# even when another window covers it).
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SimShot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
'@
$handle = (Get-Process FlightSimulator2024 -ErrorAction Stop).MainWindowHandle
$client = New-Object SimShot+RECT
[void][SimShot]::GetClientRect($handle, [ref]$client)
$bitmap = New-Object System.Drawing.Bitmap $client.Right, $client.Bottom
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
# PW_CLIENTONLY (1) | PW_RENDERFULLCONTENT (2)
$ok = [SimShot]::PrintWindow($handle, $hdc, 3)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
"captured=$ok $($client.Right)x$($client.Bottom) -> $Out"
