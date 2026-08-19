# Builds a dev-signed MSIX and installs it on this machine.
#
# ASCII ONLY (Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI).
#
#   .\install-dev-msix.ps1                  build, trust the cert, replace the install
#   .\install-dev-msix.ps1 -SkipBuild       reinstall the package already built
#   .\install-dev-msix.ps1 -Platform x64    override the auto-detected architecture
#
# Run it from the devcontainer instead with `npm run install:desktop`, which syncs
# the working tree over first so uncommitted changes are what gets installed.
#
# Why this exists rather than "run build-msix.ps1 and double-click the result":
# three things have to happen around the build, and each one fails in a way that
# is hard to read.
#
#   1. The self-signed certificate has to be TRUSTED, or the install fails with a
#      bare "publisher name doesn't match" or a trust error. build-msix.ps1 creates
#      the certificate and tells you to trust it by hand; this does it.
#   2. The previous install has to be REMOVED when it came from somewhere else.
#      The package family name is a hash of Name + Publisher, so a package signed
#      by a different certificate is a different app: install it and you get two
#      identical tray icons rather than an update. A Visual Studio build signs with
#      `CN=<your username>` and this script signs with `CN=Persistent Dev`, so the
#      first run after switching has to clear the other one out.
#   3. The install has to run in the INTERACTIVE session. Over SSH you land in
#      session 0, where AppX deployment fails with 0x80070005 and a deployment log
#      reading "Failed to initialize PLM". Elevation does not help. This relaunches
#      the install half as a scheduled task marked interactive.
#
# App state survives all of this: settings.json, the logs and the WebView2 profile
# (which is what keeps you signed in) live in the real %AppData%\Persistent, not in
# the package's private store, so removing and re-adding the package keeps them.

[CmdletBinding()]
param(
    [ValidateSet('x64', 'ARM64')]
    [string]$Platform,
    [switch]$SkipBuild,
    # Must match build-msix.ps1's -CertPassword, which is what wrote the .pfx this
    # opens. Not a secret: it protects a self-signed certificate that exists only on
    # the developer's own machine, and the .pfx itself is gitignored.
    [string]$CertPassword = 'persistent',
    # Internal: the scheduled task re-enters here to do the install half in the
    # user's own session.
    [switch]$InstallOnly,
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'

$logPath  = 'C:\Temp\persistent-msix-install.log'
$taskName = 'PersistentDevMsixInstall'

function Write-Step([string]$message) {
    Write-Host $message
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
    Add-Content -Path $logPath -Value $message
}

# --- The install half -----------------------------------------------------
# Kept in this same file so there is one script to sync and one to read, and
# reached either directly (already interactive) or through the task below.
function Install-Package([string]$package) {
    Write-Step "Installing $package"
    Write-Step "  session $((Get-Process -Id $PID).SessionId), user $env:USERNAME"
    try {
        # -ForceApplicationShutdown because the tray app is almost always running:
        # without it the install fails on a package still in use, which is the
        # normal case rather than the exception.
        Add-AppxPackage -Path $package -ForceApplicationShutdown
        Write-Step "OK installed"
    } catch {
        Write-Step "FAILED $($_.Exception.Message)"
        throw
    }

    # Launched, not left for the user to find. This is a tray app with no window of
    # its own, so an install that ends here looks identical to one that failed:
    # nothing appears, and the icon Windows 11 files into the hidden overflow is not
    # something anyone checks. Started through explorer so it runs as the user
    # rather than inheriting this script's token.
    $installed = Get-AppxPackage -Name 'Persistent.Desktop'
    if ($installed) {
        Write-Step "Launching $($installed.PackageFamilyName)"
        & explorer.exe "shell:AppsFolder\$($installed.PackageFamilyName)!App"
    }
}

if ($InstallOnly) {
    if (-not $PackagePath) { throw '-InstallOnly needs -PackagePath' }
    Install-Package $PackagePath
    return
}

Remove-Item $logPath -Force -ErrorAction SilentlyContinue

if (-not $Platform) {
    $Platform = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'ARM64' } else { 'x64' }
}

$msixDir = Join-Path $PSScriptRoot 'Persistent.DesktopMSIX'
$certPath = Join-Path $msixDir 'Persistent.Desktop.pfx'

[xml]$props = Get-Content (Join-Path $PSScriptRoot 'Directory.Build.props')
$version = ($props.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
$package = Join-Path $msixDir "Persistent.Desktop_${version}_$Platform.msix"

Write-Step "Persistent $version, $Platform"

# --- Build ----------------------------------------------------------------
# Built BEFORE anything is removed, deliberately: a build that fails should leave
# the machine with the app it already had, not with no app at all.
if (-not $SkipBuild) {
    if (-not (Test-Path (Join-Path $msixDir 'Images'))) {
        Write-Step 'Generating package images...'
        & (Join-Path $msixDir 'generate-msix-images.ps1')
    }
    Write-Step 'Building the package...'
    & (Join-Path $msixDir 'build-msix.ps1') -Platform $Platform -CertPassword $CertPassword
}
if (-not (Test-Path $package)) { throw "No package at $package" }

# --- Trust the signing certificate ----------------------------------------
# TrustedPeople is the store Windows checks for a sideloaded package, and the
# import needs administrator rights. An SSH session for an admin on Windows is
# already elevated, so this normally just works; run from a plain console it does
# not, and saying so beats an install failing with a trust error two steps later.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
    $certPath, (ConvertTo-SecureString $CertPassword -AsPlainText -Force))
$trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
           Where-Object { $_.Thumbprint -eq $cert.Thumbprint }

if ($trusted) {
    Write-Step "Certificate already trusted ($($cert.Subject), $($cert.Thumbprint))"
} elseif (-not $isAdmin) {
    throw "Not elevated, so the signing certificate cannot be trusted. Re-run this from an " +
          "administrator PowerShell, or over SSH as an admin (which is elevated already)."
} else {
    Write-Step "Trusting $($cert.Subject) ($($cert.Thumbprint))"
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPeople', 'LocalMachine')
    $store.Open('ReadWrite')
    try {
        # The public certificate only. The .pfx holds the private key, and nothing
        # about verifying a signature needs it in a machine-wide store.
        #
        # ::new(), not New-Object: New-Object splats an array across the
        # constructor's parameters, so a 788-byte RawData arrives as 788 arguments
        # and it fails looking for an overload that could never exist.
        $store.Add([System.Security.Cryptography.X509Certificates.X509Certificate2]::new($cert.RawData))
    } finally {
        $store.Close()
    }
}

# --- Clear a package of the same app signed by someone else ---------------
# Matched on the app's own Name rather than a wildcard, so this can never touch
# the Store package (`27766TechnicallyReal.Persistent`), which is a different app
# with a different identity and is allowed to sit alongside this one.
# Every running copy is stopped first, not just the one being replaced.
# `Add-AppxPackage -ForceApplicationShutdown` closes only the app it is updating,
# and a package signed by a different certificate is a different family, so
# installing over it leaves the old process alive: it keeps its tray icon, holds
# its already-deleted install folder open, and you spend a while looking at the
# old build convinced the install did nothing. The new one is launched at the end,
# so stopping all of them costs nothing.
Get-Process -Name 'Persistent.Desktop' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Step "Stopping running Persistent.Desktop (pid $($_.Id))"
    Stop-Process -Id $_.Id -Force
}

$stale = @(Get-AppxPackage -Name 'Persistent.Desktop' |
           Where-Object { $_.Publisher -ne $cert.Subject })
foreach ($old in $stale) {
    Write-Step "Removing $($old.PackageFullName) (publisher $($old.Publisher))"
    Remove-AppxPackage -Package $old.PackageFullName
}

# --- Install --------------------------------------------------------------
if ((Get-Process -Id $PID).SessionId -ne 0) {
    Install-Package $package
    Write-Step 'Done.'
    return
}

# Session 0: hand the install to the logged-on user's session.
Write-Step 'Session 0, so installing through an interactive scheduled task...'
$command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -InstallOnly -PackagePath `"$package`""
# /st is required and irrelevant: the task is started by hand below and deleted
# straight after, so the time it would otherwise have run never arrives.
& schtasks /create /tn $taskName /tr $command /sc once /st 23:59 /it /f | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not create the install task' }
try {
    & schtasks /run /tn $taskName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the install task' }

    # Polled rather than assumed: schtasks returns as soon as the task is queued,
    # and the install takes a few seconds. The task writes its own outcome into the
    # same log, so waiting for that line is waiting for the real result.
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        $log = Get-Content $logPath -ErrorAction SilentlyContinue
        if ($log -match '^OK installed$' -or $log -match '^FAILED ') { break }
    }
} finally {
    & schtasks /delete /tn $taskName /f 2>&1 | Out-Null
}

$installed = Get-AppxPackage -Name 'Persistent.Desktop'
if (-not $installed) { throw "Install did not complete. See $logPath" }
Write-Step "Done: $($installed.PackageFullName)"
