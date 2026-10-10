<# Capture real desktop context around the default native tray flyout.
ScriptFile evaluates demo navigation in the existing isolated WebView; Output captures
physical desktop pixels without scaling, compositing, or changing tray settings.
#>
param(
    [string]$DemoUrl = 'http://localhost:22750',
    [string]$ScriptFile,
    [string]$Output
)
# Drive the already-running capture WebView, never a standalone browser.
$demoOrigin = [Uri]$DemoUrl
if ($demoOrigin.Host -notin @('localhost', '127.0.0.1') -or $demoOrigin.Scheme -ne 'http') { throw 'A local demo URL is required.' }
$ErrorActionPreference = 'Stop'
$targets = Invoke-RestMethod http://localhost:9224/json/list
$target = $targets | Where-Object { $_.type -eq 'page' -and $_.url.StartsWith($DemoUrl.TrimEnd('/') + '/') } | Select-Object -First 1
if (!$target) { throw 'No demo flyout WebView at the selected local origin on the capture port.' }
if ($ScriptFile) {
    $socket = [Net.WebSockets.ClientWebSocket]::new()
    $timeout = [Threading.CancellationTokenSource]::new(15000)
    try {
        $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $timeout.Token).GetAwaiter().GetResult() | Out-Null
        $request = @{ id=1; method='Runtime.evaluate'; params=@{
            expression=(Get-Content $ScriptFile -Raw); awaitPromise=$true; returnByValue=$true
        }} | ConvertTo-Json -Depth 20 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($request)
        $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, $timeout.Token).GetAwaiter().GetResult() | Out-Null
        do {
            $stream = [IO.MemoryStream]::new()
            do {
                $buffer = [byte[]]::new(65536)
                $message = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $timeout.Token).GetAwaiter().GetResult()
                $stream.Write($buffer, 0, $message.Count)
            } while (!$message.EndOfMessage)
            $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        } while ($response.id -ne 1)
        if ($response.result.exceptionDetails) { throw ($response.result.exceptionDetails | ConvertTo-Json -Depth 10) }
        $response.result.result.value | ConvertTo-Json -Depth 10 -Compress
    } finally {
        $socket.Dispose()
        $timeout.Dispose()
    }
}
if ($Output) {
    Add-Type -AssemblyName System.Drawing,System.Windows.Forms
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class StoreFlyoutCapture {
    public static IntPtr Find(string title) { return FindWindow(null,title); }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string name,string title);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
    # Window bounds and CopyFromScreen must use the same physical-pixel coordinate space.
    [StoreFlyoutCapture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
    $window = [StoreFlyoutCapture]::Find('Persistent')
    if ($window -eq [IntPtr]::Zero -or ![StoreFlyoutCapture]::IsWindowVisible($window)) { throw 'The actual flyout must be visible.' }
    [StoreFlyoutCapture]::SetForegroundWindow($window) | Out-Null
    Start-Sleep -Milliseconds 600
    $bounds = [StoreFlyoutCapture+Rect]::new()
    [StoreFlyoutCapture]::GetWindowRect($window, [ref]$bounds) | Out-Null
    # Capture a real desktop region at native resolution, including wallpaper and taskbar.
    # Anchor at the tray corner so personal desktop shortcuts and centered app buttons stay outside.
    $screen = [Windows.Forms.Screen]::FromHandle($window).Bounds
    $exportWidth = 1440
    $exportHeight = 1700
    $left = $screen.Right - $exportWidth
    $top = $screen.Bottom - $exportHeight
    if ($screen.Width -lt $exportWidth -or $screen.Height -lt $exportHeight) {
        throw 'The capture monitor must fit a native 1440 x 1700 desktop crop.'
    }
    if ($bounds.Left -lt $left -or $bounds.Top -lt $top -or $bounds.Right -gt $screen.Right -or $bounds.Bottom -gt $screen.Bottom) {
        throw 'The default flyout is outside the tray-corner desktop crop.'
    }
    $canvas = [Drawing.Bitmap]::new($exportWidth,$exportHeight,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.CopyFromScreen($left,$top,0,0,[Drawing.Size]::new($exportWidth,$exportHeight))
        $canvas.Save($Output,[Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $canvas.Dispose()
    }
    Write-Output "Saved native desktop context: $Output ($exportWidth x $exportHeight)"
}
