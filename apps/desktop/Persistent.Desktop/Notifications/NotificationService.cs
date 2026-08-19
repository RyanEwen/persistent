using Microsoft.Windows.AppNotifications;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.Windows;
using System.Collections.Concurrent;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// Optional Windows toasts for the tray app: the one piece of this host that is
/// about reminders rather than windows.
///
/// <para><b>Read docs/desktop-architecture.md before changing this.</b> The app was
/// built as a viewing and acting surface with no OS notifications at all, and this
/// is a deliberate, bounded reversal of that: off by default, opt-in per machine,
/// and still not a persistence guarantee — a sleeping machine, a closed app or a
/// dropped connection all mean no toast, and there is no alarm audio and no
/// on-device scheduling. The Android client remains the only surface that
/// guarantees anything.</para>
///
/// <para>What it does own is small and stated here so it can be checked against
/// docs/notification-behavior.md:</para>
/// <list type="bullet">
///   <item>One toast per <b>occurrence</b>, never per reminder (§4, independence).</item>
///   <item>Done is a <b>two-tap confirm</b> (§1), implemented by replacing the
///         toast with a confirm variant rather than acking on first click.</item>
///   <item>A server <c>dismiss</c> clears the toast, so acting on any device clears
///         it here (cross-device dismiss, docs/data-event-contract.md).</item>
///   <item>Snooze and Done are the server's calls to accept or reject; this holds
///         no opinion about when either is allowed.</item>
/// </list>
///
/// <para>Silence is deliberately absent: it drops an escalation back to an
/// ordinary notification, and this surface has no alarm to silence.</para>
/// </summary>
internal static class NotificationService
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private static readonly ToastNotifier Toasts = new();
    private static RealtimeClient? _realtime;
    private static OccurrenceApi? _api;

    /// <summary>
    /// The last event seen per occurrence, so the confirm toast can be rebuilt with
    /// the same title and body when Done is armed, and restored on "Not yet".
    /// Bounded by how many firings are unconfirmed at once, and entries are dropped
    /// as soon as they are dismissed.
    /// </summary>
    private static readonly ConcurrentDictionary<string, RealtimeEvent> Live = new();

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
        _realtime ??= new RealtimeClient(AppFlyout.GetSessionCookieAsync, () => SettingsManager.Current.EffectiveServerUrl);
        _realtime.EventReceived -= OnRealtimeEvent;
        _realtime.EventReceived += OnRealtimeEvent;
        _realtime.Start();
        return true;
    }

    private static void Disable()
    {
        _realtime?.Stop();
        Live.Clear();
        // Clear before unregistering: removal goes through the same manager.
        _ = Toasts.RemoveAllAsync().ContinueWith(_ => Toasts.Unregister(), TaskScheduler.Default);
    }

    /// <summary>Release the toast registration on exit.</summary>
    public static void Shutdown()
    {
        _realtime?.Stop();
        Toasts.Unregister();
    }

    private static void OnRealtimeEvent(RealtimeEvent occurrence)
    {
        switch (occurrence.Type)
        {
            case "occurrence.fired":
                Live[occurrence.OccurrenceId] = occurrence;
                Toasts.ShowOccurrence(occurrence, SnoozeMinutes);
                break;

            case "occurrence.changed":
                // Only an escalation is worth re-raising: it is the firing getting
                // louder. An ack or a snooze arrives as `dismiss` instead, and
                // re-showing on every status change would resurrect toasts the user
                // has already dealt with.
                if (occurrence.IsEscalated)
                {
                    Live[occurrence.OccurrenceId] = occurrence;
                    Toasts.ShowOccurrence(occurrence, SnoozeMinutes);
                }
                break;

            case "dismiss":
                Live.TryRemove(occurrence.OccurrenceId, out _);
                _ = Toasts.RemoveAsync(occurrence.OccurrenceId);
                break;

            // "silence" stops an escalation alarm but keeps the occurrence nagging.
            // There is no alarm here to stop and the toast should stay, so: nothing.
            default:
                break;
        }
    }

    /// <summary>
    /// Which duration the toast's snooze picker starts on. Only a starting point —
    /// the user picks from the full list on the toast itself, the same list every
    /// other surface offers.
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
                    if (Live.TryGetValue(occurrenceId, out var armed)) Toasts.ShowDoneConfirm(armed);
                    break;

                case ToastNotifier.ActionNotYet:
                    if (Live.TryGetValue(occurrenceId, out var restored))
                        Toasts.ShowOccurrence(restored, SnoozeMinutes);
                    break;

                case ToastNotifier.ActionConfirmDone:
                    _ = ActAsync(occurrenceId, ack: true);
                    break;

                case ToastNotifier.ActionSnooze:
                    // Whatever the toast's picker was left on; the app setting only
                    // decided which item started selected.
                    _ = ActAsync(occurrenceId, ack: false, ToastNotifier.ChosenSnoozeMinutes(args.UserInput) ?? SnoozeMinutes);
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
    private static async Task ActAsync(string occurrenceId, bool ack, int snoozeMinutes = 0)
    {
        if (_api == null) return;
        bool ok = ack
            ? await _api.AckAsync(occurrenceId)
            : await _api.SnoozeAsync(occurrenceId, snoozeMinutes > 0 ? snoozeMinutes : SnoozeMinutes);

        if (ok)
        {
            // The server also broadcasts `dismiss`, which would remove this anyway;
            // doing it here too makes the toast go away immediately rather than at
            // socket latency, and RemoveAsync is idempotent.
            Live.TryRemove(occurrenceId, out _);
            await Toasts.RemoveAsync(occurrenceId);
            return;
        }

        Logger.Warn("Toast {0} failed for occurrence {1}; leaving the toast up",
            ack ? "Done" : "Snooze", occurrenceId);
        if (Live.TryGetValue(occurrenceId, out var unchanged)) Toasts.ShowOccurrence(unchanged, SnoozeMinutes);
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
