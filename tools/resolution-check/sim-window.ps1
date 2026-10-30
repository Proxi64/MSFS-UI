param([int]$Width = 0, [int]$Height = 0, [int]$X = 0, [int]$Y = 0)
# Reports the sim's main window (style, window and client rectangles, monitor), and with -Width/-Height sizes its
# client area to exactly that, at X, Y (the window's border and title added around it).
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SimWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool AdjustWindowRectEx(ref RECT r, int style, bool menu, int exStyle);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
$process = Get-Process FlightSimulator2024 -ErrorAction Stop
$handle = $process.MainWindowHandle
$style = [SimWindow]::GetWindowLong($handle, -16)
$exStyle = [SimWindow]::GetWindowLong($handle, -20)
if ($Width -gt 0 -and $Height -gt 0) {
  $rect = New-Object SimWindow+RECT
  $rect.Left = 0; $rect.Top = 0; $rect.Right = $Width; $rect.Bottom = $Height
  [void][SimWindow]::AdjustWindowRectEx([ref]$rect, $style, $false, $exStyle)
  # SWP_NOZORDER | SWP_NOACTIVATE
  [void][SimWindow]::SetWindowPos($handle, [IntPtr]::Zero, $X + $rect.Left, $Y + $rect.Top, $rect.Right - $rect.Left, $rect.Bottom - $rect.Top, 0x0004 -bor 0x0010)
  Start-Sleep -Milliseconds 500
}
$window = New-Object SimWindow+RECT
$client = New-Object SimWindow+RECT
[void][SimWindow]::GetWindowRect($handle, [ref]$window)
[void][SimWindow]::GetClientRect($handle, [ref]$client)
'style=0x{0:X8} caption={1} window={2},{3}-{4},{5} client={6}x{7} screen={8}x{9}' -f $style, (($style -band 0x00C00000) -eq 0x00C00000), $window.Left, $window.Top, $window.Right, $window.Bottom, $client.Right, $client.Bottom, [SimWindow]::GetSystemMetrics(0), [SimWindow]::GetSystemMetrics(1)
