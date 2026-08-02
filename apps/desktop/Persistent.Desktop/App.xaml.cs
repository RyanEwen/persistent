using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Persistent.Desktop.Classes;
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
        StartupDiagnostics.Mark("OnLaunched");
        MainDispatcherQueue = DispatcherQueue.GetForCurrentThread();

        if (!Singleton.WaitOne(TimeSpan.Zero, true))
        {
            // Already running: hand the request to that instance and step aside.
            IntPtr existing = FindWindow(null, MainWindow.HostWindowTitle);
            if (existing != IntPtr.Zero)
            {
                StartupDiagnostics.Mark("Second instance - handed off to the running one");
                PostMessage(existing, MainWindow.WmShowFlyout, IntPtr.Zero, IntPtr.Zero);
            }
            else
            {
                // The mutex is held but the host window is gone: an earlier instance
                // is running without its window, so nothing would happen and this
                // launch would look like a no-op. Say so rather than exiting quietly.
                StartupDiagnostics.Warn(
                    "Persistent is already running, but its window could not be found.\n\n" +
                    "End the Persistent.Desktop.exe task in Task Manager, then start it again.");
            }
            Environment.Exit(0);
            return;
        }

        AppDomain.CurrentDomain.UnhandledException += (s, a) =>
        {
            var ex = a.ExceptionObject as Exception;
            Logger.Error(ex, "Unhandled exception");
            NLog.LogManager.Flush();
            if (ex != null) StartupDiagnostics.Fatal("Unhandled exception", ex);
        };
        UnhandledException += (s, e) =>
        {
            Logger.Error(e.Exception, "Unhandled UI exception");
            NLog.LogManager.Flush();
            StartupDiagnostics.Mark($"Unhandled UI exception: {e.Exception}");
            e.Handled = true;
        };

        // Each stage is recorded so a silent death is still diagnosable: whichever
        // milestone is missing from startup.log is where it stopped.
        try
        {
            StartupDiagnostics.Mark("Restoring settings");
            SettingsManager.RestoreSettings();

            StartupDiagnostics.Mark("Creating tray host");
            _host = new MainWindow();
            _host.Activate();
            _host.HideHost(); // Activate() shows the window; immediately re-hide the invisible host.
            StartupDiagnostics.Mark("Startup complete");
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Startup failed");
            NLog.LogManager.Flush();
            StartupDiagnostics.Fatal("Startup", ex);
            Environment.Exit(1);
        }
    }

    private MainWindow? _host;
}
