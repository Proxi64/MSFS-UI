# Draws the icon of MSFS-UI-GENERATOR: an application window in the sim's blues (title bar, tiles) with the Windows
# airplane glyph in its corner. Each size is drawn on its own (the small ones without details, so that they stay
# sharp), then all are stored as PNG images in one .ico file.
#   pwsh -File tools\make-icon.ps1            # writes generator\MsfsUi.App\Assets\AppIcon.ico
#   pwsh -File tools\make-icon.ps1 -Preview   # also writes the 256 px image next to it, to look at
param([string]$Output = (Join-Path $PSScriptRoot '..\generator\MsfsUi.App\Assets\AppIcon.ico'), [switch]$Preview)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
# The sim's colours: --colorPrimary #3B84EB, --colorGradient #144893.
$primary = [System.Drawing.Color]::FromArgb(255, 0x3B, 0x84, 0xEB)
$gradient = [System.Drawing.Color]::FromArgb(255, 0x14, 0x48, 0x93)
$airplane = [char]::ConvertFromUtf32(0xEB4C)   # AirplaneSolid
$iconFont = @('Segoe Fluent Icons', 'Segoe MDL2 Assets') | Where-Object {
  (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name -contains $_
} | Select-Object -First 1
if (-not $iconFont) { throw 'Neither Segoe Fluent Icons nor Segoe MDL2 Assets is installed.' }

function New-RoundedRectangle([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $radius
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $width - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $width - $d, $y + $height - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $height - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconImage([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 256.0
  $small = $size -le 32

  # The window: a rounded rectangle with the sim's gradient.
  $wx = 8 * $s; $wy = 28 * $s; $ww = 240 * $s; $wh = 200 * $s
  $window = New-RoundedRectangle $wx $wy $ww $wh ([Math]::Max(2, 28 * $s))
  $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.PointF($wx, $wy)), (New-Object System.Drawing.PointF(($wx + $ww), ($wy + $wh))), $primary, $gradient)
  $g.FillPath($fill, $window)

  # Its title bar: darker, with three dots.
  $bar = $small ? 50 * $s : 40 * $s
  $g.SetClip($window)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(110, 0, 0, 0))), $wx, $wy, $ww, $bar)
  $g.ResetClip()
  if (-not $small) {
    $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
    foreach ($i in 0..2) { $g.FillEllipse($dot, ($wx + (20 + 22 * $i) * $s), ($wy + 13 * $s), (13 * $s), (13 * $s)) }
  }

  # The content: two rows of tiles on the left, as in the menu.
  if (-not $small) {
    $tile = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(85, 255, 255, 255))
    foreach ($row in 0..1) {
      foreach ($column in 0..1) {
        $tx = $wx + (20 + 58 * $column) * $s
        $ty = $wy + $bar + (18 + 58 * $row) * $s
        $g.FillPath($tile, (New-RoundedRectangle $tx $ty (48 * $s) (46 * $s) (8 * $s)))
      }
    }
  }

  # The airplane, white, in the bottom-right corner, over a soft shadow.
  $glyphSize = ($small ? 150 : 128) * $s
  $font = New-Object System.Drawing.Font($iconFont, $glyphSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $cx = ($small ? 140 : 168) * $s; $cy = ($small ? 140 : 160) * $s
  $box = New-Object System.Drawing.RectangleF(($cx - $glyphSize), ($cy - $glyphSize), (2 * $glyphSize), (2 * $glyphSize))
  if (-not $small) {
    $shadow = New-Object System.Drawing.RectangleF(($box.X + 4 * $s), ($box.Y + 5 * $s), $box.Width, $box.Height)
    $g.DrawString($airplane, $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 0, 0, 0))), $shadow, $format)
  }
  $g.DrawString($airplane, $font, [System.Drawing.Brushes]::White, $box, $format)
  $g.Dispose()
  return $bitmap
}

# One .ico with a PNG image per size (supported since Windows Vista).
$images = foreach ($size in $sizes) {
  $bitmap = New-IconImage $size
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($Preview) { $bitmap.Save([System.IO.Path]::ChangeExtension($Output, ".preview-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bitmap.Dispose()
  [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
}

$file = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($image in $images) {
  $dimension = $image.Size -ge 256 ? 0 : $image.Size
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
  $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
  $offset += $image.Bytes.Length
}
foreach ($image in $images) { $writer.Write($image.Bytes) }
$writer.Flush()
[System.IO.File]::WriteAllBytes((Resolve-Path -LiteralPath (Split-Path $Output -Parent)).Path + '\' + (Split-Path $Output -Leaf), $file.ToArray())
Write-Host "Icon written: $Output ($($images.Count) sizes, $([Math]::Round($file.Length / 1KB)) KB, font $iconFont)"
