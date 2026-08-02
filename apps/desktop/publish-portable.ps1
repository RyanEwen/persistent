# Publishes a PORTABLE build: a folder with Persistent.Desktop.exe that runs on a
# clean Windows 11 machine with nothing installed first -- no MSIX, no certificate
# to trust, no .NET runtime, no Windows App SDK runtime. Unzip and run.
#
# This is the build to use for testing. MSIX (Persistent.DesktopMSIX/) is for
# actually shipping: it gives a real install, Start menu entry, and the
# windows.startupTask registration. Unpackaged, "start at sign-in" falls back to
# the per-user Run key (see Classes/StartupManager.cs), so that still works here.
#
# ASCII ONLY (Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI).
#
#   .\publish-portable.ps1                  auto-detect architecture
#   .\publish-portable.ps1 -Platform ARM64
#   .\publish-portable.ps1 -NoZip           leave the folder, skip the archive

[CmdletBinding()]
param(
    [ValidateSet('x64', 'ARM64')]
    [string]$Platform,
    [switch]$NoZip
)

$ErrorActionPreference = 'Stop'

$root    = $PSScriptRoot
$project = Join-Path $root 'Persistent.Desktop\Persistent.Desktop.csproj'
$outRoot = Join-Path $root 'artifacts'

if (-not $Platform) {
    $Platform = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'ARM64' } else { 'x64' }
}
$rid = if ($Platform -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }

[xml]$props = Get-Content (Join-Path $root 'Directory.Build.props')
$version = ($props.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
if (-not $version) { throw 'Could not read <Version> from Directory.Build.props' }

$name    = "Persistent.Desktop-$version-$Platform-portable"
$publish = Join-Path $outRoot $name

Write-Host "Publishing $name..."
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
New-Item -ItemType Directory -Force -Path $publish | Out-Null

# The icons are gitignored build output and the csproj only picks up
# ApplicationIcon when the .ico already exists, so render them first or the exe
# ships with the generic default.
$icon = Join-Path $root 'Persistent.Desktop\Resources\Persistent.ico'
if (-not (Test-Path $icon)) {
    Write-Host "Icons missing - generating..."
    & (Join-Path $root 'Persistent.DesktopMSIX\generate-msix-images.ps1')
}

# SelfContained bundles .NET; WindowsAppSDKSelfContained bundles the Windows App
# SDK runtime. Both are needed for "unzip and run" on a machine that has neither
# -- without the second, the app dies at startup with a missing-runtime error
# that reads like a crash.
& dotnet publish $project `
    -c Release `
    -r $rid `
    -p:Platform=$Platform `
    -p:SelfContained=true `
    -p:WindowsAppSDKSelfContained=true `
    -p:WindowsPackageType=None `
    -o $publish
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

# A plain-language note beside the exe: an unsigned binary off the internet gets
# a SmartScreen prompt, and "Windows protected your PC" reads like a virus
# warning rather than "this build is unsigned".
$readme = @"
Persistent for Windows $version ($Platform) - portable test build

To run:
  1. Unzip this folder somewhere (anywhere - it does not install).
  2. Run Persistent.Desktop.exe.
  3. Windows SmartScreen will warn that the publisher is unknown, because this
     build is not code-signed. Click "More info" then "Run anyway".

A bell icon appears in the notification area (you may need to drag it out of the
hidden-icons overflow). Left-click it for the reminders flyout, right-click for
the menu.

What this app does NOT do: it never rings, and it cannot reach you while it is
closed. It shows what is due and lets you confirm it. The Android app is what
guarantees a reminder actually reaches you.

Settings and logs: %AppData%\Persistent
To remove it: exit from the tray menu, then delete this folder (and
%AppData%\Persistent if you want the saved sign-in gone too).
"@
Set-Content -Path (Join-Path $publish 'READ ME FIRST.txt') -Value $readme -Encoding ASCII

if (-not $NoZip) {
    $zip = Join-Path $outRoot "$name.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Write-Host "Compressing..."
    Compress-Archive -Path (Join-Path $publish '*') -DestinationPath $zip
    $mb = [Math]::Round((Get-Item $zip).Length / 1MB, 1)
    Write-Host ""
    Write-Host "Built $zip ($mb MB)"
} else {
    Write-Host ""
    Write-Host "Built $publish"
}
