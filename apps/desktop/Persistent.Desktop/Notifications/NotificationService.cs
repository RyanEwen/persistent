using Microsoft.Windows.AppNotifications;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.Windows;
using System.Collections.Concurrent;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// Persistent Windows notifications for the tray app: the one piece of this host
/// that is about reminders rather than windows.
///
/// <para><b>Read docs/desktop-architecture.md before changing this.</b> The app was
/// built as a viewing and acting surface with no OS notifications at all, and this
/// is a deliberate, bounded reversal of that. It remains session-bound: prolonged
/// sleep, shutdown or a closed tray process can delay delivery, while Android is
/// still the only exact-alarm guarantee.</para>
///
/// <para>What it does own is small and stated here so it can be checked against
/// docs/notification-behavior.md:</para>
/// <list type="bullet">
///   <item>One toast per <b>occurrence</b>, never per reminder (§4, independence).</item>
///   <item>Done is a <b>two-tap confirm</b> (§1), implemented by replacing the
///         toast with a confirm variant rather than acking on first click.</item>
///   <item>A server <c>dismiss</c> clears the toast, so acting on any device clears
///         it here (cross-device dismiss, docs/data-event-contract.md).</item>
///   <item>Soft notifications return after dismissal and may re-alert on their nag
///         interval; alarm notifications loop audio until acted on.</item>
///   <item>Snooze, Done and De-escalate are the server's calls to accept or reject;
///         this holds no opinion about when any is allowed.</item>
/// </list>
/// </summary>
internal static class NotificationService
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private static readonly ToastNotifier Toasts = new();
    private static RealtimeClient? _realtime;
    private static OccurrenceApi? _api;
    private static OccurrenceSyncClient? _syncClient;
    private static NotificationPersistenceMonitor? _monitor;
    private static readonly SemaphoreSlim RefreshGate = new(1, 1);
    private static volatile bool _enabled;
    private static int _lifecycleVersion;

    /// <summary>
    /// The server-projected active notification plus its local presentation state.
    /// Bounded by how many firings are unconfirmed at once; dismissing a toast does
    /// not remove an entry because restoring it is the defining behavior.
    /// </summary>
    private static readonly ConcurrentDictionary<string, TrackedNotification> Live = new();

    /// <summary>
    /// Bring the service in line with the current setting. Safe to call repeatedly —
    /// from startup, and from the settings toggle.
    ///
    /// <para>Turning it on can fail, and when it does <b>the setting is corrected
    /// rather than left claiming otherwise</b>. The settings screen is the page's
    /// now (<see cref="Classes.Settings.HostSettings"/>), and it reports this stored
    /// value back to the user; a toggle reading "on" while toast registration failed
    /// would be promising notifications that can never arrive. Correcting it here
    /// also means the failure survives a restart instead of being retried silently
    /// on every launch.</para>
    /// </summary>
    public static void Sync()
    {
        if (!SettingsManager.Current.DesktopNotifications)
        {
            Disable();
            return;
        }
        if (Enable()) return;

        // Re-entrant, and deliberately so rather than guarded with a flag: assigning
        // this fires UserSettings.OnDesktopNotificationsChanged, which calls straight
        // back into Sync. That pass reads the value we just wrote, takes the Disable
        // branch above, and returns — one level deep, always terminating, and it
        // leaves the teardown to the one place that owns it. Disable is safe with
        // nothing to tear down; it is already the path a never-enabled service takes.
        SettingsManager.Current.DesktopNotifications = false;
        SettingsManager.SaveSettings();
    }

    /// <summary>Connect and register, reporting whether notifications can now arrive.</summary>
    private static bool Enable()
    {
        if (_realtime is { IsRunning: true }) return true;

        if (!Toasts.Register(OnInvoked))
        {
            // Registration is what routes clicks back to this process. Without it a
            // toast would appear and then do nothing, which is worse than none.
            Logger.Warn("Notifications enabled but toast registration failed; not connecting");
            Classes.StartupDiagnostics.Mark("notifications: toast registration FAILED");
            return false;
        }

        // Recorded in startup.log as well as the NLog file: this is the breadcrumb
        // that separates "the user never turned it on" from "it was on and did not
        // work", which is the first fork in diagnosing silent notifications.
        Classes.StartupDiagnostics.Mark("notifications: enabled, toast registration OK");

        _api ??= new OccurrenceApi(AppFlyout.GetSessionCookieAsync, () => SettingsManager.Current.EffectiveServerUrl);
        _syncClient ??= new OccurrenceSyncClient(
            AppFlyout.GetSessionCookieAsync,
            () => SettingsManager.Current.EffectiveServerUrl);
        _realtime ??= new RealtimeClient(AppFlyout.GetSessionCookieAsync, () => SettingsManager.Current.EffectiveServerUrl);
        _monitor ??= new NotificationPersistenceMonitor(Live, Toasts, ShowAndTrack, RequestRefresh);

        _realtime.Connected -= RequestRefresh;
        _realtime.Connected += RequestRefresh;
        _realtime.EventReceived -= OnRealtimeEvent;
        _realtime.EventReceived += OnRealtimeEvent;

        _enabled = true;
        Interlocked.Increment(ref _lifecycleVersion);
        _realtime.Start();
        _monitor.Start();
        return true;
    }

    private static void Disable()
    {
        _enabled = false;
        _monitor?.Stop();
        _realtime?.Stop();
        Live.Clear();
        int disabledVersion = Interlocked.Increment(ref _lifecycleVersion);
        _ = ClearAndUnregisterAsync(disabledVersion);
    }

    /// <summary>Release the toast registration on exit.</summary>
    public static void Shutdown()
    {
        _enabled = false;
        _monitor?.Stop();
        _realtime?.Stop();
        Toasts.Unregister();
    }

    /// <summary>
    /// Clear before unregistering because removal goes through the notification
    /// manager. A rapid off/on toggle invalidates this teardown before it can
    /// unregister the newly re-enabled service.
    /// </summary>
    private static async Task ClearAndUnregisterAsync(int disabledVersion)
    {
        await Toasts.RemoveAllAsync();
        if (!_enabled && Volatile.Read(ref _lifecycleVersion) == disabledVersion)
        {
            Toasts.Unregister();
        }
    }

    /// <summary>
    /// Remove the departing account's personal notification content immediately.
    /// The service remains enabled so the realtime retry loop can recover after a
    /// later sign-in without changing the machine setting.
    /// </summary>
    public static void UserSignedOut()
    {
        Live.Clear();
        _ = Toasts.RemoveAllAsync();
    }

    private static void OnRealtimeEvent(RealtimeSignal signal)
    {
        switch (signal.Type)
        {
            case "dismiss":
                Live.TryRemove(signal.OccurrenceId, out _);
                _ = Toasts.RemoveAsync(signal.OccurrenceId);
                break;

            case "silence":
                // Stop the looping alarm immediately. The refresh replaces it with
                // the server-computed soft notification.
                Live.TryRemove(signal.OccurrenceId, out _);
                _ = Toasts.RemoveAsync(signal.OccurrenceId);
                RequestRefresh();
                break;

            default:
                // Occurrence and reminder events are invalidation hints. Pull the
                // canonical device-alarm projection rather than reproducing its
                // persistence, escalation or checklist rules in C#.
                RequestRefresh();
                break;
        }
    }

    /// <summary>
    /// Refresh the active set from the server. Calls are serialized so a burst of
    /// realtime invalidations cannot race an older response over a newer one.
    /// </summary>
    private static void RequestRefresh() => _ = RefreshAsync();

    private static async Task RefreshAsync()
    {
        if (!_enabled || _syncClient == null) return;

        await RefreshGate.WaitAsync();
        try
        {
            if (!_enabled) return;

            var result = await _syncClient.GetActiveAsync();
            if (result == null || !_enabled) return;
            if (!result.Authorized)
            {
                UserSignedOut();
                return;
            }

            var occurrences = result.Occurrences;

            var incoming = occurrences
                .Select(occurrence => occurrence.OccurrenceId)
                .ToHashSet(StringComparer.Ordinal);

            foreach (string occurrenceId in Live.Keys)
            {
                if (incoming.Contains(occurrenceId)) continue;

                Live.TryRemove(occurrenceId, out _);
                _ = Toasts.RemoveAsync(occurrenceId);
            }

            foreach (var occurrence in occurrences)
            {
                if (Live.TryGetValue(occurrence.OccurrenceId, out var tracked)
                    && tracked.Occurrence == occurrence)
                {
                    continue;
                }

                ShowAndTrack(occurrence);
            }
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Refreshing active Windows notifications failed");
        }
        finally
        {
            RefreshGate.Release();
        }
    }

    /// <summary>Show one occurrence and record the successful presentation time.</summary>
    private static void ShowAndTrack(NotificationOccurrence occurrence)
    {
        if (!_enabled || !Toasts.ShowOccurrence(occurrence, SnoozeMinutes)) return;
        Live[occurrence.OccurrenceId] = new TrackedNotification(occurrence, DateTimeOffset.UtcNow);
    }

    /// <summary>
    /// Which duration the toast's snooze picker starts on. This is only a starting
    /// point; Windows offers the five-item subset its combo box permits.
    /// </summary>
    private static int SnoozeMinutes
    {
        get
        {
            int minutes = SettingsManager.Current.NotificationSnoozeMinutes;
            return minutes is >= 1 and <= 1440 ? minutes : 10;
        }
    }

    /// <summary>
    /// A click on a toast or one of its buttons. Runs on a background thread, so
    /// anything touching a window hops to the UI queue.
    /// </summary>
    private static void OnInvoked(AppNotificationActivatedEventArgs args)
    {
        try
        {
            var arguments = args.Arguments;
            arguments.TryGetValue(ToastNotifier.ActionKey, out var action);
            arguments.TryGetValue(ToastNotifier.OccurrenceKey, out var occurrenceId);
            arguments.TryGetValue(ToastNotifier.ReminderKey, out var reminderId);
            if (string.IsNullOrEmpty(occurrenceId)) return;

            switch (action)
            {
                case ToastNotifier.ActionDone:
                    // First tap only arms it (§1). Nothing is acknowledged yet.
                    if (Live.TryGetValue(occurrenceId, out var armed)
                        && Toasts.ShowDoneConfirm(armed.Occurrence))
                    {
                        Live[occurrenceId] = armed with
                        {
                            LastShownAt = DateTimeOffset.UtcNow,
                            ConfirmingDone = true
                        };
                    }
                    break;

                case ToastNotifier.ActionNotYet:
                    if (Live.TryGetValue(occurrenceId, out var restored))
                        ShowAndTrack(restored.Occurrence);
                    break;

                case ToastNotifier.ActionConfirmDone:
                    _ = ActAsync(occurrenceId, ToastNotifier.ActionConfirmDone);
                    break;

                case ToastNotifier.ActionSnooze:
                    // Whatever the toast's picker was left on; the app setting only
                    // decided which item started selected.
                    _ = ActAsync(
                        occurrenceId,
                        ToastNotifier.ActionSnooze,
                        ToastNotifier.ChosenSnoozeMinutes(args.UserInput) ?? SnoozeMinutes);
                    break;

                case ToastNotifier.ActionSilence:
                    _ = ActAsync(occurrenceId, ToastNotifier.ActionSilence);
                    break;

                default:
                    // Body click: hand off to the real surface, on the reminder the
                    // toast was about.
                    OpenInFlyout(reminderId);
                    break;
            }
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Handling a toast activation failed");
        }
    }

    /// <summary>
    /// Send the action, then clear the toast on success. On failure the toast is
    /// left showing on purpose: the occurrence is still unconfirmed, and clearing it
    /// would tell the user something was done that wasn't.
    /// </summary>
    private static async Task ActAsync(string occurrenceId, string action, int snoozeMinutes = 0)
    {
        if (_api == null) return;
        bool ok = action switch
        {
            ToastNotifier.ActionConfirmDone => await _api.AckAsync(occurrenceId),
            ToastNotifier.ActionSnooze => await _api.SnoozeAsync(
                occurrenceId,
                snoozeMinutes > 0 ? snoozeMinutes : SnoozeMinutes),
            ToastNotifier.ActionSilence => await _api.SilenceAsync(occurrenceId),
            _ => false
        };

        if (ok)
        {
            // The server also broadcasts `dismiss`, which would remove this anyway;
            // doing it here too makes the toast go away immediately rather than at
            // socket latency, and RemoveAsync is idempotent.
            Live.TryRemove(occurrenceId, out _);
            await Toasts.RemoveAsync(occurrenceId);
            if (action == ToastNotifier.ActionSilence) RequestRefresh();
            return;
        }

        Logger.Warn("Toast {0} failed for occurrence {1}; leaving the toast up",
            action, occurrenceId);
        if (Live.TryGetValue(occurrenceId, out var unchanged)) ShowAndTrack(unchanged.Occurrence);
    }

    private static void OpenInFlyout(string? reminderId)
    {
        App.MainDispatcherQueue?.TryEnqueue(() =>
        {
            AppFlyout.Show();
            if (!string.IsNullOrEmpty(reminderId)) AppFlyout.NavigateToReminder(reminderId);
        });
    }
}
