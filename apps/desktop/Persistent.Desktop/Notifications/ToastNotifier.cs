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
    public const string ActionSilence = "silence";

    /// <summary>Which duration the toast's picker is on, read back on activation.</summary>
    public const string SnoozeChoiceKey = "snoozeMinutes";

    /// <summary>
    /// Windows allows a toast combo box **five items**, and throws
    /// <c>ArgumentException("Maximum number of items added")</c> on the sixth. That
    /// exception escapes mid-build, so the whole toast fails and nothing is shown:
    /// one item too many silently disables notifications entirely. This shipped
    /// with seven and no toast ever appeared.
    /// </summary>
    private const int MaxComboItems = 5;

    /// <summary>
    /// The snooze durations offered on a toast: a five-item subset of
    /// `SNOOZE_PRESETS` in `apps/web/src/lib/durations.ts`, chosen to span the same
    /// range (minutes to a day) within the platform's limit. Snoozing is a *choice*
    /// about when to be asked again, so the picker stays — the full seven are one
    /// click away in the flyout.
    ///
    /// **Do not add a sixth.** See <see cref="MaxComboItems"/>.
    ///
    /// Kept as a literal rather than fetched: it is a list of durations, not a
    /// rule, so it cannot disagree with the server about anything.
    /// </summary>
    private static readonly (int Minutes, string Label)[] SnoozeChoices =
    [
        (5, "5 min"),
        (15, "15 min"),
        (30, "30 min"),
        (60, "1 hr"),
        (1440, "1 day")
    ];

    /// <summary>
    /// The choices a toast will actually carry, truncation included.
    ///
    /// Exposed so the settings picker can offer exactly these and no more
    /// (<see cref="Classes.Settings.HostSettings"/>). It previously offered the
    /// full seven from `SNOOZE_PRESETS`, which meant two of them could never become
    /// the toast's selection: the setting's whole job is to choose which of *these*
    /// starts selected, so <see cref="NearestOffered"/> silently corrected them. The
    /// shipped default of 10 minutes was one of the two, so the settings screen read
    /// "10 min" while every toast opened on "5 min".
    /// </summary>
    public static (int Minutes, string Label)[] OfferedSnoozeChoices => SnoozeChoices.Take(MaxComboItems).ToArray();

    /// <summary>
    /// The offered duration closest to <paramref name="minutes"/>, for a caller that
    /// has a stored value and needs one the picker can actually show.
    /// </summary>
    public static int NearestOffered(int minutes) => NearestChoice(OfferedSnoozeChoices, minutes);

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
    /// Show or replace one persistent firing. Soft notifications use the Default
    /// scenario so the popup retracts while the item remains in Notification
    /// Center. Inherent and escalated alarms use Alarm so Windows keeps the popup
    /// visible and loops its alarm audio until the user acts.
    /// </summary>
    public bool ShowOccurrence(NotificationOccurrence occurrence, int defaultSnoozeMinutes)
    {
        if (!_registered) return false;
        try
        {
            var builder = new AppNotificationBuilder()
                .AddText(occurrence.Title)
                .SetTag(occurrence.OccurrenceId)
                .SetGroup(Group)
                .SetScenario(ScenarioFor(occurrence))
                // Body clicks and button clicks arrive through the same handler, so
                // every toast carries the ids its actions will need.
                .AddArgument(ActionKey, ActionOpen)
                .AddArgument(OccurrenceKey, occurrence.OccurrenceId)
                .AddArgument(ReminderKey, occurrence.ReminderId);

            if (occurrence.Body.Length > 0) builder.AddText(occurrence.Body);
            if (occurrence.Alarm)
            {
                builder.AddText("Alarm - still not confirmed.");
            }

            // A picker, not a fixed duration: snoozing is a choice about when to be
            // asked again, and every other surface offers the same list (see
            // SnoozeChoices). The app setting only chooses which one starts selected.
            // Truncated rather than trusted: overrunning the limit throws mid-build
            // and costs the whole toast, so an over-long list degrades to a short
            // picker instead of to no notifications at all.
            var offered = SnoozeChoices.Take(MaxComboItems).ToArray();
            var picker = new AppNotificationComboBox(SnoozeChoiceKey)
                .SetSelectedItem(NearestChoice(offered, defaultSnoozeMinutes).ToString());
            foreach (var (minutes, label) in offered) picker.AddItem(minutes.ToString(), label);

            builder
                .AddComboBox(picker)
                .AddButton(Button(ActionDone, occurrence, "Done"))
                .AddButton(Button(ActionSnooze, occurrence, "Snooze"));

            if (occurrence.CanSilence)
            {
                builder.AddButton(Button(ActionSilence, occurrence, "De-escalate"));
            }

            ShowHighPriority(builder);
            return true;
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Showing a toast failed for occurrence {0}", occurrence.OccurrenceId);
            return false;
        }
    }

    /// <summary>
    /// The armed half of the two-tap Done: same tag, so it replaces the toast in
    /// place rather than stacking a second one. "Not yet" restores the original and
    /// changes nothing, exactly as it does in-app.
    /// </summary>
    public bool ShowDoneConfirm(NotificationOccurrence occurrence)
    {
        if (!_registered) return false;
        try
        {
            var builder = new AppNotificationBuilder()
                .AddText(occurrence.Title)
                .AddText("Mark this done?")
                .SetTag(occurrence.OccurrenceId)
                .SetGroup(Group)
                .SetScenario(ScenarioFor(occurrence))
                .AddArgument(ActionKey, ActionOpen)
                .AddArgument(OccurrenceKey, occurrence.OccurrenceId)
                .AddArgument(ReminderKey, occurrence.ReminderId)
                .AddButton(Button(ActionConfirmDone, occurrence, "Confirm done"))
                .AddButton(Button(ActionNotYet, occurrence, "Not yet"));

            ShowHighPriority(builder);
            return true;
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Showing the confirm toast failed for occurrence {0}", occurrence.OccurrenceId);
            return false;
        }
    }

    /// <summary>
    /// Read the occurrence tags still present in Notification Center. A successful
    /// empty set means the user dismissed them; <c>null</c> means Windows could not
    /// answer and must not trigger a mass re-post.
    /// </summary>
    public async Task<HashSet<string>?> GetShownOccurrenceIdsAsync()
    {
        if (!_registered) return null;

        try
        {
            var notifications = await AppNotificationManager.Default.GetAllAsync();
            return notifications
                .Where(notification => notification.Group == Group)
                .Select(notification => notification.Tag)
                .Where(tag => !string.IsNullOrEmpty(tag))
                .ToHashSet(StringComparer.Ordinal);
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Reading shown notifications failed");
            return null;
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
    /// Choose Windows presentation behavior without changing persistence policy.
    /// Default popups retract on their own but stay in Notification Center. Alarm
    /// popups remain visible and audible because that is the requested hard nag.
    /// </summary>
    private static AppNotificationScenario ScenarioFor(NotificationOccurrence occurrence) =>
        occurrence.Alarm ? AppNotificationScenario.Alarm : AppNotificationScenario.Default;

    /// <summary>
    /// Show a notification with Persistent's per-notification urgency hint. Windows
    /// still owns the user's app-wide Top, High, or Normal preference and may apply
    /// Focus Assist or other system policy.
    /// </summary>
    private static void ShowHighPriority(AppNotificationBuilder builder)
    {
        var notification = builder.BuildNotification();
        notification.Priority = AppNotificationPriority.High;
        AppNotificationManager.Default.Show(notification);
    }

    /// <summary>
    /// The offered duration closest to <paramref name="minutes"/>. The stored
    /// default comes from a settings combo that may be edited by hand or predate a
    /// change to the list, and a picker whose selection matches no item renders
    /// blank — so this always resolves to something real.
    ///
    /// Takes the choices actually added to the picker, not the full list: selecting
    /// an item that was truncated away would leave the picker blank.
    /// </summary>
    private static int NearestChoice((int Minutes, string Label)[] choices, int minutes)
    {
        int best = choices[0].Minutes;
        foreach (var (candidate, _) in choices)
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

    private static AppNotificationButton Button(string action, NotificationOccurrence occurrence, string label) =>
        new AppNotificationButton(label)
            .AddArgument(ActionKey, action)
            .AddArgument(OccurrenceKey, occurrence.OccurrenceId)
            .AddArgument(ReminderKey, occurrence.ReminderId);
}
