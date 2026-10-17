# Re-render one captured simulation frame to PNG with GDI+.
#
# The simulation records the canvas ops the bundle actually issued
# (translate -> rotate -> scale -> fillRect, with the live fillStyle/globalAlpha),
# so replaying them here reproduces the frame the browser would paint.
#
# Usage: powershell -ExecutionPolicy Bypass -File verify/render-frame.ps1 [-Index 0,1,2]

param(
  [string]$FramesPath,
  [int[]]$Index = @()
)

Add-Type -AssemblyName System.Drawing

if (-not $FramesPath) {
  $FramesPath = Join-Path $PSScriptRoot 'frames.json'
}
if (-not (Test-Path -LiteralPath $FramesPath)) {
  throw "missing $FramesPath - run: node verify/simulate.mjs"
}

# frames.json is UTF-8 and now carries localized button strings, so the read
# must be explicit: Windows PowerShell's default code page mangles them.
$data = Get-Content -LiteralPath $FramesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$width = [int]$data.viewport.width
$height = [int]$data.viewport.height
$outputs = @()

if ($Index.Count -eq 0) {
  $Index = 0..([int]$data.frames.Count - 1)
}

foreach ($i in $Index) {
  if ($i -ge $data.frames.Count) { continue }
  $frameData = $data.frames[$i]

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(11, 14, 24))

  foreach ($op in $frameData.ops) {
    $graphics.ResetTransform()
    $graphics.TranslateTransform([float]$op.x, [float]$op.y)
    $graphics.RotateTransform([float]($op.rot * 180.0 / [math]::PI))
    $graphics.ScaleTransform(1.0, [float]$op.sy)

    $rgb = [System.Drawing.ColorTranslator]::FromHtml([string]$op.color)
    $alpha = [math]::Min(255, [math]::Max(0, [int][math]::Round(255 * [double]$op.alpha)))
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, $rgb.R, $rgb.G, $rgb.B))
    $graphics.FillRectangle(
      $brush,
      [float](-[double]$op.w / 2.0),
      [float](-[double]$op.h / 2.0),
      [float][double]$op.w,
      [float][double]$op.h
    )
    $brush.Dispose()
  }

  # Viewport edge, so the bottom corners the poppers fire from are readable.
  $graphics.ResetTransform()
  $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 120, 140, 200)), 1
  $graphics.DrawRectangle($edge, 0, 0, $width - 1, $height - 1)
  $edge.Dispose()

  $outPath = Join-Path $PSScriptRoot ("frame-{0}.png" -f $frameData.frame)
  $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  $outputs += [pscustomobject]@{
    frame  = $frameData.frame
    seconds = $frameData.timeSeconds
    pieces = $frameData.ops.Count
    file   = $outPath
  }
}

$outputs | Format-Table -AutoSize
