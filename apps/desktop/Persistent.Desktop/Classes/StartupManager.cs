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

    /// <summary>
    /// Re-point an existing Run-key entry at wherever this executable now lives.
    ///
    /// The unpackaged fallback records an absolute path, captured when the user
    /// turned the setting on. That is fine for an installed app and wrong for the
    /// portable build, which is run from wherever it was unzipped: download a newer
    /// one and it lands in a *new* folder, leaving the entry aimed at the old copy —
    /// which then starts a stale version at boot, or nothing at all once that folder
    /// is deleted. Either way the user's setting silently stops meaning what it says.
    ///
    /// Only rewrites an entry that already exists: relocating is not consent to
    /// enable startup for someone who never asked for it. Inert when packaged, where
    /// the startup task is used and no Run-key entry exists to find.
    /// </summary>
    public static void RefreshRunKeyPath()
    {
        try
        {
            string? exe = Environment.ProcessPath;
            if (exe == null) return;

            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (key?.GetValue(ValueName) is not string existing) return;

            string wanted = $"\"{exe}\"";
            if (string.Equals(existing, wanted, StringComparison.OrdinalIgnoreCase)) return;

            key.SetValue(ValueName, wanted);
            StartupDiagnostics.Mark($"start-at-sign-in re-pointed to {exe}");
        }
        catch
        {
            // Best effort: a stale startup entry is a nuisance, not worth a crash.
        }
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
