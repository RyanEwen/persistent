using Microsoft.Win32;
using Windows.ApplicationModel;

namespace Persistent.Desktop.Classes;

/// <summary>
/// Toggles "run at sign-in". For the packaged app this drives the MSIX
/// <c>windows.startupTask</c> (declared in the manifest, enabled by default);
/// unpackaged dev builds fall back to the per-user Run key.
///
/// This matters more here than in a typical tray app: the flyout's badge and the
/// PWA's live WebSocket only exist while the process is running, so an app that
/// isn't started is an app showing nothing.
/// </summary>
internal static class StartupManager
{
    private const string TaskId = "PersistentDesktopAutoStart";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "PersistentDesktop";

    public static void SetRunAtStartup(bool enabled)
    {
        // Fire-and-forget on a background thread so we never block the UI thread on a WinRT async.
        _ = Task.Run(async () =>
        {
            try
            {
                var task = await StartupTask.GetAsync(TaskId);
                if (enabled) await task.RequestEnableAsync();
                else task.Disable();
            }
            catch
            {
                SetRunKey(enabled); // unpackaged / API unavailable
            }
        });
    }

    public static bool IsEnabled()
    {
        try
        {
            var task = Task.Run(async () => await StartupTask.GetAsync(TaskId)).GetAwaiter().GetResult();
            return task.State is StartupTaskState.Enabled or StartupTaskState.EnabledByPolicy;
        }
        catch
        {
            return IsRunKeyEnabled();
        }
    }

    private static void SetRunKey(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (key == null) return;
            if (enabled)
            {
                string? exe = Environment.ProcessPath;
                if (exe != null) key.SetValue(ValueName, $"\"{exe}\"");
            }
            else if (key.GetValue(ValueName) != null)
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
            }
        }
        catch { /* best effort */ }
    }

    private static bool IsRunKeyEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) != null;
        }
        catch { return false; }
    }
}
