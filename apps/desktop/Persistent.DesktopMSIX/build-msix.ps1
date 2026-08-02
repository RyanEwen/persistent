# Publishes Persistent.Desktop and packages it as an MSIX.
#
# ASCII ONLY (Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI).
#
#   .\build-msix.ps1                 signed sideload build (dev cert, updates in place)
#   .\build-msix.ps1 -NoSign         unsigned, for a Store upload (the Store re-signs)
#   .\build-msix.ps1 -Platform ARM64 override the auto-detected architecture

[CmdletBinding()]
param(
    [ValidateSet('x64', 'ARM64')]
    [string]$Platform,
    [switch]$NoSign,
    [string]$CertPath = "$PSScriptRoot\Persistent.Desktop.pfx",
    [string]$CertPassword = 'persistent'
)

$ErrorActionPreference = 'Stop'

$msixDir    = $PSScriptRoot
$root       = Split-Path -Parent $msixDir
$project    = Join-Path $root 'Persistent.Desktop\Persistent.Desktop.csproj'
$layout     = Join-Path $msixDir 'layout'
$imagesDir  = Join-Path $msixDir 'Images'

if (-not $Platform) {
    $Platform = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'ARM64' } else { 'x64' }
}
$rid = if ($Platform -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }

# --- Version (single source of truth: Directory.Build.props) -------------
[xml]$props = Get-Content (Join-Path $root 'Directory.Build.props')
$version = ($props.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
if (-not $version) { throw 'Could not read <Version> from Directory.Build.props' }
# MSIX needs 4 parts and the Store requires the revision to be 0.
$manifestVersion = "$version.0"
Write-Host "Version $version (manifest $manifestVersion), platform $Platform"

if (-not (Test-Path $imagesDir)) {
    throw "Images\ is missing. Run generate-msix-images.ps1 first."
}

# --- SDK packaging tools --------------------------------------------------
function Resolve-SdkTool([string]$name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $sdkRoots = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "$env:ProgramFiles\Windows Kits\10\bin"
    ) | Where-Object { Test-Path $_ }
    foreach ($sdkRoot in $sdkRoots) {
        $found = Get-ChildItem -Path $sdkRoot -Filter $name -Recurse -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -match "\\$Platform\\|\\x64\\" } |
                 Sort-Object FullName -Descending | Select-Object -First 1
        if ($found) { return $found.FullName }
    }

    # Fall back to the BuildTools NuGet package, acquiring it if needed.
    $pkgRoot = Join-Path $env:TEMP 'PersistentSdkTools'
    $installed = Get-ChildItem -Path $pkgRoot -Filter $name -Recurse -ErrorAction SilentlyContinue |
                 Select-Object -First 1
    if (-not $installed) {
        Write-Host "Acquiring Microsoft.Windows.SDK.BuildTools..."
        New-Item -ItemType Directory -Force -Path $pkgRoot | Out-Null
        & nuget install Microsoft.Windows.SDK.BuildTools -OutputDirectory $pkgRoot -ExcludeVersion 2>$null
        if ($LASTEXITCODE -ne 0) {
            & dotnet tool run nuget 2>$null
            throw "Could not find $name and could not acquire the SDK BuildTools. Install the Windows SDK."
        }
        $installed = Get-ChildItem -Path $pkgRoot -Filter $name -Recurse | Select-Object -First 1
    }
    return $installed.FullName
}

$makeappx = Resolve-SdkTool 'makeappx.exe'
$makepri  = Resolve-SdkTool 'makepri.exe'
$signtool = if ($NoSign) { $null } else { Resolve-SdkTool 'signtool.exe' }

# --- Publish --------------------------------------------------------------
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Force -Path $layout | Out-Null

# NOT -p:WindowsPackageType=MSIX. That belongs to the single-project MSIX model,
# where the csproj itself owns Package.appxmanifest as an <AppxManifest> item; the
# SDK enforces it with
#   Error Condition="'$(WindowsPackageType)' != 'None' and '@(AppxManifest)'==''"
# (Microsoft.Windows.SDK.BuildTools.MSIX.Packaging.targets), whose message reads
# backwards but means "you asked for a packaged build and gave me no manifest".
# This script packages EXTERNALLY instead - publish a plain layout, drop the
# manifest in below, then makeappx - so the project stays unpackaged here and the
# flag only broke the publish.
Write-Host "Publishing $rid..."
& dotnet publish $project `
    -c Release `
    -r $rid `
    -p:Platform=$Platform `
    -p:SelfContained=true `
    -o $layout
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

# --- Assemble the layout --------------------------------------------------
Copy-Item $imagesDir (Join-Path $layout 'Images') -Recurse -Force

$manifestOut = Join-Path $layout 'AppxManifest.xml'
(Get-Content (Join-Path $msixDir 'Package.appxmanifest') -Raw) `
    -replace 'VERSION_PLACEHOLDER', $manifestVersion `
    -replace 'ARCH_PLACEHOLDER', $Platform.ToLower() |
    Set-Content $manifestOut -Encoding UTF8

# Signed sideload builds get a local identity so repeat installs update in place
# instead of colliding with the Store identity.
if (-not $NoSign) {
    $cert = $null
    if (Test-Path $CertPath) {
        $secure = ConvertTo-SecureString $CertPassword -AsPlainText -Force
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertPath, $secure)
    } else {
        Write-Host "Creating a self-signed dev certificate..."
        $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=Persistent Dev' `
            -KeyUsage DigitalSignature -FriendlyName 'Persistent Desktop dev' `
            -CertStoreLocation 'Cert:\CurrentUser\My' `
            -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
        $secure = ConvertTo-SecureString $CertPassword -AsPlainText -Force
        Export-PfxCertificate -Cert $cert -FilePath $CertPath -Password $secure | Out-Null
    }
    $xml = Get-Content $manifestOut -Raw
    $xml = $xml -replace 'Publisher="CN=Persistent"', ('Publisher="' + $cert.Subject + '"')
    Set-Content $manifestOut $xml -Encoding UTF8
    Write-Host "Sideload identity: $($cert.Subject)"
}

# --- Resources + package --------------------------------------------------
Push-Location $layout
try {
    & $makepri createconfig /cf priconfig.xml /dq en-US /o | Out-Null
    & $makepri new /pr . /cf priconfig.xml /of resources.pri /o | Out-Null
    Remove-Item priconfig.xml -Force -ErrorAction SilentlyContinue
} finally {
    Pop-Location
}

$outName = "Persistent.Desktop_${version}_$Platform.msix"
$outPath = Join-Path $msixDir $outName
if (Test-Path $outPath) { Remove-Item $outPath -Force }

& $makeappx pack /d $layout /p $outPath /o
if ($LASTEXITCODE -ne 0) { throw 'makeappx failed' }

if (-not $NoSign) {
    & $signtool sign /fd SHA256 /a /f $CertPath /p $CertPassword $outPath
    if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }
    Write-Host "Signed."
    Write-Host "Sideload installs need the dev certificate trusted once:"
    Write-Host "  Import-Certificate -FilePath <exported .cer> -CertStoreLocation Cert:\LocalMachine\Root"
}

Write-Host ""
Write-Host "Built $outPath"
