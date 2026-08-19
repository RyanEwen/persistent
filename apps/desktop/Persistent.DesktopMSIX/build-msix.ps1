# Publishes Persistent.Desktop and packages it as an MSIX.
#
# ASCII ONLY (Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI).
#
#   .\build-msix.ps1                 signed sideload build (dev cert, updates in place)
#   .\build-msix.ps1 -Store          unsigned, real Store identity, for Partner Center
#   .\build-msix.ps1 -Upload         both architectures, plus the .msixupload container
#   .\build-msix.ps1 -Platform ARM64 override the auto-detected architecture
#
# The two modes differ in IDENTITY, not just signing. A Store package must carry
# the Partner Center Name/Publisher verbatim and stays unsigned (the Store
# re-signs it); anything else it would be signed with here is thrown away. A
# sideload package is rewritten to a local identity and dev-signed, so repeat
# installs update in place and a sideloaded copy never collides with a Store one.

[CmdletBinding()]
param(
    [ValidateSet('x64', 'ARM64')]
    [string]$Platform,
    [switch]$Store,
    [switch]$Upload,
    [string]$CertPath = "$PSScriptRoot\Persistent.Desktop.pfx",
    [string]$CertPassword = 'persistent'
)

$ErrorActionPreference = 'Stop'

# -Upload is only ever a Store artifact, so it implies -Store rather than making
# the caller remember both. Sideloading takes the single .msix matching the
# machine; there is nothing a dev-signed container would be for.
if ($Upload) { $Store = $true }
if ($Upload -and $Platform) { throw '-Upload builds both architectures; drop -Platform.' }

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
$signtool = if ($Store) { $null } else { Resolve-SdkTool 'signtool.exe' }

# --- Upload: build each architecture, then wrap them for msstore ----------
# Both forms are produced on purpose, because the two submission routes want
# different files:
#
#   the loose per-arch .msix   -> what you drag into the Partner Center UI
#   the .msixupload container  -> what `msstore publish` consumes
#
# Do not "simplify" this to the container alone. It is a plain zip of the two
# packages, and Partner Center's web upload does not take it reliably - the
# sibling apps learned that one the hard way and now document it as a warning.
if ($Upload) {
    foreach ($p in @('x64', 'ARM64')) {
        Write-Host ""
        Write-Host "=== $p ==="
        # No $LASTEXITCODE check: that variable belongs to the last *native*
        # command, so after a script call it still holds whatever makeappx or
        # signtool last set, and reading it here reports a stale result either
        # way. A failure inside propagates as a throw ($ErrorActionPreference).
        & $PSCommandPath -Platform $p -Store
    }

    $packages = @('x64', 'ARM64') | ForEach-Object {
        $path = Join-Path $msixDir "Persistent.Desktop_${version}_$_.msix"
        if (-not (Test-Path $path)) { throw "Expected package is missing: $path" }
        $path
    }

    $uploadPath = Join-Path $msixDir "Persistent.Desktop_$version.msixupload"
    $zipPath    = [System.IO.Path]::ChangeExtension($uploadPath, '.zip')
    foreach ($stale in @($uploadPath, $zipPath)) {
        if (Test-Path $stale) { Remove-Item $stale -Force }
    }
    # Compress-Archive insists on a .zip destination, so build it as one and rename.
    Compress-Archive -Path $packages -DestinationPath $zipPath -Force
    Move-Item $zipPath $uploadPath -Force

    Write-Host ""
    foreach ($p in $packages) { Write-Host "Built $p" }
    Write-Host "Built $uploadPath"
    Write-Host "Partner Center UI: upload the two .msix files. msstore publish: the .msixupload."
    return
}

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
# WindowsAppSdkBootstrapInitialize=false is required and not cosmetic. The project
# is WindowsPackageType=None (it has to be - see the note above), which injects the
# Windows App SDK auto-initializer: a bootstrapper whose whole job is finding the
# framework for an UNPACKAGED process. Inside a packaged app it has no business
# running, and the package carries Microsoft.WindowsAppRuntime.Bootstrap.dll with
# nothing legitimate to do. The sibling apps suppress it by publishing with
# WindowsPackageType=MSIX; that route is closed here because EnableMsixTooling is
# on, which makes the SDK demand an <AppxManifest> item the project deliberately
# does not have. This property is the same suppression without the conflict.
& dotnet publish $project `
    -c Release `
    -r $rid `
    -p:Platform=$Platform `
    -p:SelfContained=true `
    -p:WindowsAppSdkBootstrapInitialize=false `
    -o $layout
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

# --- Assemble the layout --------------------------------------------------

# Compiled XAML, copied by hand because `dotnet publish` does not emit it.
#
# This is the bug that made every MSIX this script has ever produced unusable, and
# it is invisible until you install one: the package builds, signs and installs
# perfectly, then the process dies in the App constructor when InitializeComponent
# cannot find its .xbf. That is before OnLaunched, so before NLog and before
# StartupDiagnostics - no crash dialog, no event log entry, no startup.log, just a
# process that exits in under a second. It went unnoticed because CI's packaging
# step is continue-on-error and nobody had installed the result.
#
# The .xbf files exist in the RID build directory; only the publish output lacks
# them. Their layout under bin/ mirrors the package, so the relative paths carry
# over as-is. The RID folder is located by search rather than by a composed path,
# so a target-framework bump does not silently break the copy.
$releaseDir = Join-Path (Split-Path -Parent $project) "bin\$Platform\Release"
$buildDir = (Get-ChildItem $releaseDir -Directory -Recurse -Filter $rid -ErrorAction SilentlyContinue |
             Select-Object -First 1).FullName
if (-not $buildDir) { throw "Build output not found for the XAML copy: no '$rid' folder under $releaseDir" }

$xbf = @(Get-ChildItem $buildDir -Filter *.xbf -Recurse)
if ($xbf.Count -eq 0) { throw "No compiled XAML (.xbf) under $buildDir - the package would not start." }
foreach ($file in $xbf) {
    $relative = $file.FullName.Substring($buildDir.Length).TrimStart('\')
    $target = Join-Path $layout $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $file.FullName $target -Force
}
Write-Host "Copied $($xbf.Count) compiled XAML file(s) into the layout."

Copy-Item $imagesDir (Join-Path $layout 'Images') -Recurse -Force

$manifestOut = Join-Path $layout 'AppxManifest.xml'
(Get-Content (Join-Path $msixDir 'Package.appxmanifest') -Raw) `
    -replace 'VERSION_PLACEHOLDER', $manifestVersion `
    -replace 'ARCH_PLACEHOLDER', $Platform.ToLower() |
    Set-Content $manifestOut -Encoding UTF8

# Sideload builds get a local identity so repeat installs update in place instead
# of colliding with a Store install of the same app.
#
# Both attributes have to move together. The package family name is a hash of
# Name + Publisher, and Windows refuses to install a package whose declared
# Publisher is not the subject of the certificate that signed it - so leaving the
# Partner Center Publisher in place while signing with a dev cert produces a
# package that builds, signs, and then fails at install with a bare
# "publisher name doesn't match".
if (-not $Store) {
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

    # Edited through the XML DOM, not a -replace: Name="..." also appears on
    # TargetDeviceFamily and on every Capability, so a string substitution broad
    # enough to catch the identity is broad enough to corrupt those.
    [xml]$doc = Get-Content $manifestOut -Raw
    $doc.Package.Identity.SetAttribute('Name', 'Persistent.Desktop')
    $doc.Package.Identity.SetAttribute('Publisher', $cert.Subject)
    $doc.Save($manifestOut)
    Write-Host "Sideload identity: Persistent.Desktop / $($cert.Subject)"
} else {
    [xml]$doc = Get-Content $manifestOut -Raw
    Write-Host "Store identity: $($doc.Package.Identity.Name) / $($doc.Package.Identity.Publisher)"
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

if (-not $Store) {
    & $signtool sign /fd SHA256 /a /f $CertPath /p $CertPassword $outPath
    if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }
    Write-Host "Signed."
    Write-Host "Sideload installs need the dev certificate trusted once:"
    Write-Host "  Import-Certificate -FilePath <exported .cer> -CertStoreLocation Cert:\LocalMachine\Root"
} else {
    # Left unsigned on purpose: the Store re-signs at ingestion, and a package
    # signed with anything else here would have that signature thrown away.
    Write-Host "Unsigned (the Store signs it)."
}

Write-Host ""
Write-Host "Built $outPath"
