# Renders the Persistent mark once and downscales it into every asset the app and
# the Store need: the multi-size .ico, an in-app PNG, and the MSIX tile/logo set.
#
# The mark is the same bell-on-dark-tile glyph as the web favicon
# (apps/web/public/favicon.svg and components/BrandMark.tsx). Keep the three in
# step -- the tray icon, the PWA tab and the Play listing should be one mark.
#
# ASCII ONLY. Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so a UTF-8
# dash or curly quote inside a string breaks parsing in ways that are hard to see.

[CmdletBinding()]
param(
    # NOT $Master: PowerShell variable names are case-insensitive, so a $Master
    # parameter and the $master bitmap below are one variable, and the [int]
    # constraint from the param declaration stays attached to it, so assigning the
    # rendered Bitmap to it dies with "Cannot convert ... to type System.Int32".
    [int]$MasterSize = 1024
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root       = Split-Path -Parent $PSScriptRoot
$imagesDir  = Join-Path $PSScriptRoot 'Images'
$resDir     = Join-Path $root 'Persistent.Desktop\Resources'

New-Item -ItemType Directory -Force -Path $imagesDir | Out-Null
New-Item -ItemType Directory -Force -Path $resDir    | Out-Null

# Palette, matching the web favicon.
$bg     = [System.Drawing.Color]::FromArgb(255, 11, 15, 25)    # #0b0f19
$accent = [System.Drawing.Color]::FromArgb(255, 110, 168, 254) # #6ea8fe

function New-Master([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded tile. The favicon uses r=14 on a 64 viewBox.
    $u = $size / 64.0
    $r = 14 * $u
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
    $tile.AddArc($size - 2*$r, 0, 2*$r, 2*$r, 270, 90)
    $tile.AddArc($size - 2*$r, $size - 2*$r, 2*$r, 2*$r, 0, 90)
    $tile.AddArc(0, $size - 2*$r, 2*$r, 2*$r, 90, 90)
    $tile.CloseFigure()
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $g.FillPath($bgBrush, $tile)

    # The bell is drawn rotated, like the favicon's `rotate(-16 32 30)`, so it
    # reads as ringing rather than sitting still.
    $state = $g.Save()
    $g.TranslateTransform(32 * $u, 30 * $u)
    $g.RotateTransform(-16)
    $g.TranslateTransform(-32 * $u, -30 * $u)
    $g.TranslateTransform(-3.5 * $u, 0)

    $accentBrush = New-Object System.Drawing.SolidBrush($accent)

    # Bell body: dome over a flared skirt, closed along the bottom rim.
    $bell = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bell.AddArc(20*$u, 14*$u, 24*$u, 24*$u, 180, 180)   # dome (r=12 at cx=32, cy=26)
    $bell.AddLine(44*$u, 26*$u, 44*$u, 35*$u)
    $bell.AddLine(44*$u, 35*$u, 48*$u, 41*$u)
    $bell.AddLine(48*$u, 41*$u, 48*$u, 43*$u)
    $bell.AddLine(48*$u, 43*$u, 16*$u, 43*$u)
    $bell.AddLine(16*$u, 43*$u, 16*$u, 41*$u)
    $bell.AddLine(16*$u, 41*$u, 20*$u, 35*$u)
    $bell.CloseFigure()
    $g.FillPath($accentBrush, $bell)

    # Crown nub and clapper.
    $nub = New-Object System.Drawing.Drawing2D.GraphicsPath
    $nub.AddArc(30.5*$u, 9*$u, 3*$u, 3*$u, 180, 180)
    $nub.AddLine(33.5*$u, 10.5*$u, 33.5*$u, 14*$u)
    $nub.AddLine(33.5*$u, 14*$u, 30.5*$u, 14*$u)
    $nub.CloseFigure()
    $g.FillPath($accentBrush, $nub)
    $g.FillEllipse($accentBrush, 27.5*$u, 45.5*$u, 9*$u, 9*$u)

    # Motion lines, at the favicon's 55% opacity.
    # ::new() rather than New-Object: `New-Object Type(` followed by a line break
    # loses the constructor-argument special case, and PowerShell re-reads the
    # argument list as positional parameters ("no overload for 32 arguments").
    $penColor = [System.Drawing.Color]::FromArgb(140, $accent.R, $accent.G, $accent.B)
    $penWidth = [float](3.2 * $u)
    $pen = [System.Drawing.Pen]::new($penColor, $penWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, 46*$u, 22*$u, 54*$u, 18*$u)
    $g.DrawLine($pen, 48*$u, 28*$u, 56*$u, 27*$u)
    $g.DrawLine($pen, 48*$u, 34*$u, 56*$u, 35*$u)

    $g.Restore($state)
    $g.Dispose()
    return $bmp
}

function Save-Scaled($source, [int]$w, [int]$h, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # Letterbox rather than stretch: the wide Store tiles are not square, and a
    # squashed bell looks like a different app.
    $scale = [Math]::Min($w / [double]$source.Width, $h / [double]$source.Height)
    $dw = [int]([Math]::Round($source.Width * $scale))
    $dh = [int]([Math]::Round($source.Height * $scale))
    $g.DrawImage($source, [int](($w - $dw) / 2), [int](($h - $dh) / 2), $dw, $dh)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Write-Host "Rendering master at ${MasterSize}px..."
$master = New-Master $MasterSize

# --- MSIX visual assets -------------------------------------------------
$tiles = @(
    @{ n = 'Square44x44Logo.png';                w = 44;   h = 44 },
    @{ n = 'Square44x44Logo.targetsize-24_altform-unplated.png'; w = 24; h = 24 },
    @{ n = 'Square150x150Logo.png';              w = 150;  h = 150 },
    @{ n = 'Square71x71Logo.png';                w = 71;   h = 71 },
    @{ n = 'Square310x310Logo.png';              w = 310;  h = 310 },
    @{ n = 'Wide310x150Logo.png';                w = 310;  h = 150 },
    @{ n = 'StoreLogo.png';                      w = 50;   h = 50 },
    @{ n = 'SplashScreen.png';                   w = 620;  h = 300 },
    @{ n = 'LockScreenLogo.png';                 w = 24;   h = 24 }
)
foreach ($t in $tiles) {
    $path = Join-Path $imagesDir $t.n
    Save-Scaled $master $t.w $t.h $path
    Write-Host "  $($t.n)"
}

# --- In-app PNG (title bar, flyout, About) ------------------------------
$pngPath = Join-Path $resDir 'Persistent.png'
Save-Scaled $master 256 256 $pngPath
Write-Host "  Resources\Persistent.png"

# --- Multi-size .ico ----------------------------------------------------
# Written by hand: System.Drawing cannot save a multi-frame icon, and a
# single-frame one makes the tray and Alt+Tab pick a badly scaled size.
$icoPath = Join-Path $resDir 'Persistent.ico'
$sizes = @(16, 20, 24, 32, 48, 64, 128, 256)

$frames = @()
foreach ($s in $sizes) {
    $tmp = New-Object System.IO.MemoryStream
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($master, 0, 0, $s, $s)
    $g.Dispose()
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $frames += ,@{ size = $s; bytes = $tmp.ToArray() }
    $tmp.Dispose()
}

$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type: icon
$bw.Write([UInt16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
foreach ($f in $frames) {
    # 256 is encoded as 0 in the directory entry.
    $dim = if ($f.size -ge 256) { 0 } else { $f.size }
    $bw.Write([Byte]$dim)            # width
    $bw.Write([Byte]$dim)            # height
    $bw.Write([Byte]0)               # palette
    $bw.Write([Byte]0)               # reserved
    $bw.Write([UInt16]1)             # colour planes
    $bw.Write([UInt16]32)            # bits per pixel
    $bw.Write([UInt32]$f.bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $f.bytes.Length
}
foreach ($f in $frames) { $bw.Write($f.bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()
Write-Host "  Resources\Persistent.ico ($($frames.Count) frames)"

$master.Dispose()
Write-Host "Done."
