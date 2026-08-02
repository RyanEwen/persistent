using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// Builds, shows, replaces and removes the Windows toasts.
///
/// <para>Every toast is tagged with its <b>occurrence</b> id, not its reminder id.
/// Occurrences are independent (docs/notification-behavior.md §4) — a reminder
/// with three times of day can have three unconfirmed firings at once, each
/// confirmed separately — so tagging by reminder would let the 13:00 dose replace
/// the still-unconfirmed 09:00 one in the Action Center, which is the exact
/// collapse the app was built to reject.</para>
///
/// <para>Replacement by tag is also what implements the <b>two-tap Done</b>
/// (§1: Done is a two-tap confirm on every tap surface). A toast button cannot ask
/// a question, so the first Done re-shows the same tag as a confirm variant; only
/// its Confirm button acknowledges. Windows replaces a toast that shares a tag and
/// group, so this reads as the buttons changing in place.</para>
/// </summary>
internal sealed class ToastNotifier
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    /// <summary>All of this app's toasts share a group, so they can be cleared as a
    /// set when the user turns notifications off or signs out.</summary>
    public const string Group = "persistent-occurrences";

    // Argument keys, read back in NotificationService.OnInvoked.
    public const string ActionKey = "action";
    public const string OccurrenceKey = "occurrence";
    public const string ReminderKey = "reminder";

    public const string ActionOpen = "open";
    public const string ActionDone = "done";
    public const string ActionConfirmDone = "confirm-done";
    public const string ActionNotYet = "not-yet";
    public const string ActionSnooze = "snooze";

    /// <summary>Which duration the toast's picker is on, read back on activation.</summary>
    public const string SnoozeChoiceKey = "snoozeMinutes";

    /// <summary>
    /// The snooze durations, mirroring `SNOOZE_PRESETS` in
    /// `apps/web/src/lib/durations.ts` so this surface offers what every other one
    /// does. Snoozing is a *choice* about when to be asked again — a single
    /// duration buried in app settings is not the same feature.
    ///
    /// Kept as a literal rather than fetched: it is a list of durations, not a
    /// rule, so it cannot disagree with the server about anything. If the web list
    /// changes, change it here too — that is the whole maintenance burden.
    /// </summary>
    private static readonly (int Minutes, string Label)[] SnoozeChoices =
    [
        (5, "5 min"),
        (10, "10 min"),
        (15, "15 min"),
        (30, "30 min"),
        (60, "1 hr"),
        (180, "3 hr"),
        (1440, "1 day")
    ];

    private bool _registered;

    /// <summary>
    /// Start receiving activations. Unpackaged, this also creates the Start-menu
    /// shortcut Windows needs to attribute a toast to an app — a visible side
    /// effect, which is why it happens only once the user has turned notifications
    /// on rather than at every startup.
    /// </summary>
    public bool Register(Action<AppNotificationActivatedEventArgs> onInvoked)
    {
        if (_registered) return true;
        try
        {
            AppNotificationManager.Default.NotificationInvoked += (_, args) => onInvoked(args);
            AppNotificationManager.Default.Register();
            _registered = true;
            Logger.Info("Toast notifications registered");
            return true;
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Toast registration failed; notifications will not be shown");
            return false;
        }
    }

    public void Unregister()
    {
        if (!_registered) return;
        try
        {
            AppNotificationManager.Default.Unregister();
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Toast unregister failed");
        }
        _registered = false;
    }

    /// <summary>
    /// The ordinary firing toast: what it is, and the two things you can do about
    /// it.
    ///
    /// <para>Shown as <see cref="AppNotificationScenario.Reminder"/>, which keeps it
    /// on screen until the user deals with it instead of fading after a few
    /// seconds. That is as close to nagging as this surface honestly gets — it is
    /// still not the persistence guarantee, because a machine that is asleep or an
    /// app that is not running shows nothing at all.</para>
    /// </summary>
    public void ShowOccurrence(RealtimeEvent occurrence, int defaultSnoozeMinutes)
    {
        if (!_registered) return;
        try
        {
            var builder = new AppNotificationBuilder()
                .AddText(occurrence.Title)
                .SetTag(occurrence.OccurrenceId)
                .SetGroup(Group)
                // Body clicks and button clicks arrive through the same handler, so
                // every toast carries the ids its actions will need.
                .AddArgument(ActionKey, ActionOpen)
                .AddArgument(OccurrenceKey, occurrence.OccurrenceId)
                .AddArgument(ReminderKey, occurrence.ReminderId)
                .SetScenario(occurrence.IsEscalated
                    ? AppNotificationScenario.Urgent
                    : AppNotificationScenario.Reminder);

            if (occurrence.Body.Length > 0) builder.AddText(occurrence.Body);
            if (occurrence.IsEscalated)
            {
                // The alarm itself is ringing on a device that can actually ring;
                // say so rather than implying this window is the alarm.
                builder.AddText("Escalated - still not confirmed.");
            }

            // A picker, not a fixed duration: snoozing is a choice about when to be
            // asked again, and every other surface offers the same list (see
            // SnoozeChoices). The app setting only chooses which one starts selected.
            var picker = new AppNotificationComboBox(SnoozeChoiceKey)
                .SetSelectedItem(NearestChoice(defaultSnoozeMinutes).ToString());
            foreach (var (minutes, label) in SnoozeChoices) picker.AddItem(minutes.ToString(), label);

            builder
                .AddComboBox(picker)
                .AddButton(Button(ActionDone, occurrence, "Done"))
                .AddButton(Button(ActionSnooze, occurrence, "Snooze"));

            AppNotificationManager.Default.Show(builder.BuildNotification());
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Showing a toast failed for occurrence {0}", occurrence.OccurrenceId);
        }
    }

    /// <summary>
    /// The armed half of the two-tap Done: same tag, so it replaces the toast in
    /// place rather than stacking a second one. "Not yet" restores the original and
    /// changes nothing, exactly as it does in-app.
    /// </summary>
    public void ShowDoneConfirm(RealtimeEvent occurrence)
    {
        if (!_registered) return;
        try
        {
            var builder = new AppNotificationBuilder()
                .AddText(occurrence.Title)
                .AddText("Mark this done?")
                .SetTag(occurrence.OccurrenceId)
                .SetGroup(Group)
                .AddArgument(ActionKey, ActionOpen)
                .AddArgument(OccurrenceKey, occurrence.OccurrenceId)
                .AddArgument(ReminderKey, occurrence.ReminderId)
                .SetScenario(AppNotificationScenario.Reminder)
                .AddButton(Button(ActionConfirmDone, occurrence, "Confirm done"))
                .AddButton(Button(ActionNotYet, occurrence, "Not yet"));

            AppNotificationManager.Default.Show(builder.BuildNotification());
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Showing the confirm toast failed for occurrence {0}", occurrence.OccurrenceId);
        }
    }

    /// <summary>
    /// Clear one occurrence's toast everywhere it is showing. Driven by the
    /// server's `dismiss` event, so confirming on the phone clears the desktop
    /// toast too — the cross-device dismiss in docs/data-event-contract.md.
    /// </summary>
    public async Task RemoveAsync(string occurrenceId)
    {
        if (!_registered) return;
        try
        {
            await AppNotificationManager.Default.RemoveByTagAndGroupAsync(occurrenceId, Group);
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Removing the toast for occurrence {0} failed", occurrenceId);
        }
    }

    /// <summary>Clear every toast this app has shown (notifications turned off).</summary>
    public async Task RemoveAllAsync()
    {
        if (!_registered) return;
        try
        {
            await AppNotificationManager.Default.RemoveByGroupAsync(Group);
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Clearing toasts failed");
        }
    }

    /// <summary>
    /// The offered duration closest to <paramref name="minutes"/>. The stored
    /// default comes from a settings combo that may be edited by hand or predate a
    /// change to the list, and a picker whose selection matches no item renders
    /// blank — so this always resolves to something real.
    /// </summary>
    private static int NearestChoice(int minutes)
    {
        int best = SnoozeChoices[0].Minutes;
        foreach (var (candidate, _) in SnoozeChoices)
        {
            if (Math.Abs(candidate - minutes) < Math.Abs(best - minutes)) best = candidate;
        }
        return best;
    }

    /// <summary>The duration a toast activation chose, or null when it carried none.</summary>
    public static int? ChosenSnoozeMinutes(IDictionary<string, string> input)
    {
        if (!input.TryGetValue(SnoozeChoiceKey, out var raw)) return null;
        if (!int.TryParse(raw, out var minutes)) return null;
        // Bounded against the shared MAX_SNOOZE_MINUTES the server enforces, so a
        // malformed value fails here rather than as a 400 the user never sees.
        return minutes is >= 1 and <= 525_600 ? minutes : null;
    }

    private static AppNotificationButton Button(string action, RealtimeEvent occurrence, string label) =>
        new AppNotificationButton(label)
            .AddArgument(ActionKey, action)
            .AddArgument(OccurrenceKey, occurrence.OccurrenceId)
            .AddArgument(ReminderKey, occurrence.ReminderId);
}
