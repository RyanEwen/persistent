using Microsoft.Win32;
using Windows.ApplicationModel;

namespace Persistent.Desktop.Classes;

/// <summary>
/// Toggles "run at sign-in". For the packaged app this drives the MSIX
/// <c>windows.startupTask</c> (declared in the manifest, enabled by default);
/// unpackaged dev builds fall back to the per-user Run key.
///
/// This matters more here than in a typical tray app: optional Windows toasts are
/// raised by this process from its own `/ws` connection, so an app that was never
/// started is an app that cannot notify at all.
///
/// Windows is the only store for this. Nothing mirrors it into settings.json,
/// because the user can change it from Task Manager and a stored copy would then
/// be a second answer that disagrees.
/// </summary>
internal static class StartupManager
{
    private const string TaskId = "PersistentDesktopAutoStart";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "PersistentDesktop";

    /// <summary>
    /// Apply "run at sign-in" and report what Windows actually did, which is not
    /// always what was asked. A user who turns the app off in Task Manager leaves
    /// the startup task in <c>DisabledByUser</c>, and <c>RequestEnableAsync</c>
    /// cannot override that, so a caller reporting the request rather than the
    /// result would leave a toggle claiming something Windows is not honoring.
    /// </summary>
    public static async Task<bool> SetRunAtStartupAsync(bool enabled)
    {
        try
        {
            var task = await StartupTask.GetAsync(TaskId);
            if (!enabled)
            {
                task.Disable();
                return false;
            }
            var state = await task.RequestEnableAsync();
            return state is StartupTaskState.Enabled or StartupTaskState.EnabledByPolicy;
        }
        catch
        {
            SetRunKey(enabled); // unpackaged / API unavailable
            return IsRunKeyEnabled();
        }
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

    /// <summary>
    /// Whether Windows will actually start the app, asked of the OS rather than of
    /// the stored flag. Async so the caller never blocks the UI thread on a WinRT
    /// operation to answer it.
    /// </summary>
    public static async Task<bool> IsEnabledAsync()
    {
        try
        {
            var task = await StartupTask.GetAsync(TaskId);
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
