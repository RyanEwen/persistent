<# Temporarily isolate the native flyout for demo captures, then restore the user's app and settings. #>
param(
    [Parameter(Mandatory)][ValidateSet('Start', 'Show', 'Stop')][string]$Action,
    [string]$DemoUrl = 'http://localhost:22750',
    [string]$SessionRoot = (Join-Path ([IO.Path]::GetTempPath()) 'PersistentStoreCapture')
)
$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $env:APPDATA 'Persistent\settings.json'
$backupPath = Join-Path $SessionRoot 'settings.original.json'
$processPath = Join-Path $SessionRoot 'process.original.json'

if ($Action -eq 'Start') {
    $uri = [Uri]$DemoUrl
    if ($uri.Host -notin @('localhost', '127.0.0.1') -or $uri.Scheme -ne 'http') {
        throw 'Capture sessions require a local development URL.'
    }
    if (Test-Path $backupPath) { throw 'A capture backup exists. Run Stop before starting another session.' }
    $package = Get-AppxPackage -Name Persistent.Desktop
    if (!$package) { throw 'Run npm run install:desktop first. The Store package is preserved.' }
    New-Item $SessionRoot -ItemType Directory -Force | Out-Null
    Copy-Item $settingsPath $backupPath
    $running = @(Get-Process Persistent.Desktop -ErrorAction SilentlyContinue)
    ConvertTo-Json -InputObject @($running | Select-Object Path) | Set-Content $processPath
    try {
        $running | Stop-Process
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable
        $settings.ServerUrl = $DemoUrl.TrimEnd('/')
        $settings.FlyoutWidth = 420
        $settings.FlyoutHeight = 960
        $settings.FlyoutPlacement = 'tray'
        $settings.PinFlyout = $false
        $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
        # These process-local overrides leave the regular WebView cookies untouched.
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9224'
        $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $SessionRoot 'WebView2'
        Start-Process (Join-Path $package.InstallLocation 'Persistent.Desktop.exe')
    } catch {
        & $PSCommandPath -Action Stop -SessionRoot $SessionRoot
        throw
    }
    Write-Output 'Capture session started. Run Show, sign in to the demo account, and always run Stop when finished.'
}
if ($Action -eq 'Show') {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class StoreCaptureHost {
    public static IntPtr Find() { return FindWindow(null, "Persistent Host"); }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string name,string title);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
}
'@
    $window = [StoreCaptureHost]::Find()
    if ($window -eq [IntPtr]::Zero) { throw 'No running Persistent host.' }
    [StoreCaptureHost]::PostMessage($window,[StoreCaptureHost]::RegisterWindowMessage('Persistent_ShowFlyout'),[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
    Write-Output 'Requested the actual native flyout.'
}
if ($Action -eq 'Stop') {
    if (!(Test-Path $backupPath)) { throw 'No settings backup. Refusing to change the current app.' }
    Get-Process Persistent.Desktop -ErrorAction SilentlyContinue | Stop-Process
    Copy-Item $backupPath $settingsPath -Force
    $original = Get-Content $processPath -Raw | ConvertFrom-Json
    foreach ($process in @($original)) { if ($process.Path) { Start-Process $process.Path } }
    # Leave the receipt and isolated profile until restoration has been checked.
    Write-Output "Original app and settings restored. After checking, remove capture files at $SessionRoot and the separate dev package."
}
