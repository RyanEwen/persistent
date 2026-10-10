<#
Save an opaque native screenshot as a 24-bit RGB PNG for the Store asset checks.
Preserves the source dimensions and pixels; it does not crop, scale, or retouch.
Use the existing Windows System.Drawing runtime, without installing image tools.
#>
param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Bitmap]::new($InputPath)
$output = $null
try {
    $rectangle = [Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
    $output = $source.Clone($rectangle, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputPath)) | Out-Null
    $output.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved RGB capture: $($source.Width) x $($source.Height)"
} finally {
    if ($null -ne $output) { $output.Dispose() }
    $source.Dispose()
}
