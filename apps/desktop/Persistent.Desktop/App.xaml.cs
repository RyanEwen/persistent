using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Persistent.Desktop.Classes.Settings;
using System.IO;
using static Persistent.Desktop.Classes.NativeMethods;

namespace Persistent.Desktop;

/// <summary>
/// Application entry point (WinUI 3). This process is RESIDENT: an invisible
/// <see cref="MainWindow"/> owns the tray icon and keeps the WebView2 that hosts
/// the PWA warm for the lifetime of the session. There is no visible window at
/// startup — the flyout and the settings window are both shown on demand.
/// </summary>
public partial class App : Application
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    public static DispatcherQueue MainDispatcherQueue { get; private set; } = null!;

    /// <summary>Path to the multi-size app icon (.ico) for Win32 window/tray/taskbar surfaces.</summary>
    public static string IconPath => Path.Combine(AppContext.BaseDirectory, "Resources", "Persistent.ico");

    /// <summary>Path to a high-res PNG of the app icon. XAML <c>Image</c> elements decode this and
    /// scale it down crisply for whatever DPI they render at — a <c>BitmapImage</c> over the .ico
    /// would grab the tiny 16px frame and upscale it (blurry).</summary>
    public static string IconImagePath => Path.Combine(AppContext.BaseDirectory, "Resources", "Persistent.png");

    // Single resident instance — a second launch just opens the flyout on the first.
    private static readonly Mutex Singleton = new(true, "Persistent.Desktop.Instance");

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        MainDispatcherQueue = DispatcherQueue.GetForCurrentThread();

        if (!Singleton.WaitOne(TimeSpan.Zero, true))
        {
            // Already running — ask the existing instance to show the flyout, then exit.
            IntPtr existing = FindWindow(null, MainWindow.HostWindowTitle);
            if (existing != IntPtr.Zero)
                PostMessage(existing, MainWindow.WmShowFlyout, IntPtr.Zero, IntPtr.Zero);
            Environment.Exit(0);
            return;
        }

        AppDomain.CurrentDomain.UnhandledException += (s, a) =>
        {
            Logger.Error(a.ExceptionObject as Exception, "Unhandled exception");
            NLog.LogManager.Flush();
        };
        UnhandledException += (s, e) =>
        {
            Logger.Error(e.Exception, "Unhandled UI exception");
            NLog.LogManager.Flush();
            e.Handled = true;
        };

        SettingsManager.RestoreSettings();

        _host = new MainWindow();
        _host.Activate();
        _host.HideHost(); // Activate() shows the window; immediately re-hide the invisible host.
    }

    private MainWindow? _host;
}
