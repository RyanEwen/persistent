<# Render a contact sheet from the actual store PNGs without a browser or additional software. #>
param([Parameter(Mandatory)][string]$AssetsRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$manifest = Get-Content (Join-Path $AssetsRoot 'manifest.json') -Raw | ConvertFrom-Json
$canvas = [Drawing.Bitmap]::new(2200,1300,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [Drawing.Graphics]::FromImage($canvas)
$heading = [Drawing.Font]::new('Segoe UI',28,[Drawing.FontStyle]::Bold)
$label = [Drawing.Font]::new('Segoe UI',16)
$ink = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#26384a'))

# Fit each real export inside its preview cell without changing its aspect ratio.
function Draw-ContainedPreview($Image, [int]$Left, [int]$Top, [int]$Width, [int]$Height) {
    $scale = [Math]::Min($Width / $Image.Width, $Height / $Image.Height)
    $scaledWidth = [int][Math]::Round($Image.Width * $scale)
    $scaledHeight = [int][Math]::Round($Image.Height * $scale)
    $x = $Left + [int](($Width - $scaledWidth) / 2)
    $graphics.DrawImage($Image,[Drawing.Rectangle]::new($x,$Top,$scaledWidth,$scaledHeight))
}
try {
    $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#eef0f2'))
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawString('Google Play: Enjoy Light and Dark',$heading,$ink,30,18)
    for ($index=0; $index -lt $manifest.play.Count; $index++) {
        $shot = $manifest.play[$index]
        $image = [Drawing.Image]::FromFile((Join-Path $AssetsRoot $shot.file))
        try { Draw-ContainedPreview $image (30+$index*357) 78 330 587 }
        finally { $image.Dispose() }
        $name = [IO.Path]::GetFileNameWithoutExtension($shot.file).Substring(3).Replace('-',' ')
        $graphics.DrawString($name,$label,$ink,(30+$index*357),674)
    }
    $graphics.DrawString('Microsoft Store: actual Windows tray flyout',$heading,$ink,30,724)
    for ($index=0; $index -lt $manifest.microsoft.Count; $index++) {
        $shot = $manifest.microsoft[$index]
        $image = [Drawing.Image]::FromFile((Join-Path $AssetsRoot $shot.file))
        try { Draw-ContainedPreview $image (30+$index*542) 785 520 470 }
        finally { $image.Dispose() }
    }
    $output = Join-Path $AssetsRoot 'review.png'
    $canvas.Save($output,[Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved review preview: $output"
} finally {
    $ink.Dispose(); $label.Dispose(); $heading.Dispose(); $graphics.Dispose(); $canvas.Dispose()
}
