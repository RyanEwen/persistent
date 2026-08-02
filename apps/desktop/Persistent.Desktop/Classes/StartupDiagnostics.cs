using System.IO;
using System.Text;
using static Persistent.Desktop.Classes.NativeMethods;

namespace Persistent.Desktop.Classes;

/// <summary>
/// Makes a failed startup visible.
///
/// This app deliberately shows no window when it launches — just a tray icon — so
/// every failure before that icon exists looks identical to a successful start:
/// nothing happens. Worse, NLog itself may be the thing that failed, so the log
/// file cannot be relied on to explain its own absence.
///
/// So: a plain-text breadcrumb trail written with <see cref="File"/> directly (no
/// logging framework in the path), plus a message box for anything fatal. The
/// breadcrumb file is truncated on each launch, so it always describes the run the
/// user is asking about rather than the first one that ever failed.
/// </summary>
internal static class StartupDiagnostics
{
    private static readonly object Gate = new();
    private static string? _path;
    private static bool _started;

    /// <summary>`%AppData%\Persistent\startup.log` — deliberately beside settings.json.</summary>
    public static string Path
    {
        get
        {
            if (_path != null) return _path;
            string dir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Persistent");
            _path = System.IO.Path.Combine(dir, "startup.log");
            return _path;
        }
    }

    /// <summary>Record reaching a point in startup. Never throws.</summary>
    public static void Mark(string milestone)
    {
        try
        {
            lock (Gate)
            {
                string? dir = System.IO.Path.GetDirectoryName(Path);
                if (dir != null) Directory.CreateDirectory(dir);
                if (!_started)
                {
                    _started = true;
                    var header = new StringBuilder()
                        .AppendLine($"--- Persistent.Desktop startup {DateTime.Now:yyyy-MM-dd HH:mm:ss} ---")
                        .AppendLine($"exe: {Environment.ProcessPath}")
                        .AppendLine($"os: {Environment.OSVersion}  64-bit: {Environment.Is64BitProcess}")
                        .ToString();
                    File.WriteAllText(Path, header);
                }
                File.AppendAllText(Path, $"{DateTime.Now:HH:mm:ss.fff}  {milestone}{Environment.NewLine}");
            }
        }
        catch
        {
            // If we cannot even write a breadcrumb there is nothing further to try;
            // failing here must not become the crash we were trying to report.
        }
    }

    /// <summary>Record a failure and tell the user, since no window exists to show it in.</summary>
    public static void Fatal(string stage, Exception ex)
    {
        Mark($"FAILED at {stage}: {ex}");
        try
        {
            MessageBox(
                IntPtr.Zero,
                $"Persistent could not start.\n\n{stage}: {ex.Message}\n\nDetails were written to:\n{Path}",
                "Persistent",
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
        }
        catch { /* nothing left to do */ }
    }

    /// <summary>Tell the user about a non-fatal problem that would otherwise be silent.</summary>
    public static void Warn(string message)
    {
        Mark($"WARNING: {message}");
        try
        {
            MessageBox(IntPtr.Zero, message, "Persistent", MB_OK | MB_ICONWARNING | MB_SETFOREGROUND);
        }
        catch { /* best effort */ }
    }
}
