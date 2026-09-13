namespace Persistent.Desktop.Notifications;

/// <summary>
/// Display-ready description of one notification the Windows host must keep in
/// front of the user. The server owns every reminder and occurrence rule; this
/// record carries only the result needed to present and act on it.
/// </summary>
internal sealed record NotificationOccurrence(
    string OccurrenceId,
    string ReminderId,
    string Title,
    string Body,
    bool Alarm,
    bool CanSilence,
    int SoundIntervalSeconds);

/// <summary>
/// A displayed occurrence plus the last instant Windows was asked to present it.
/// The timestamp drives optional re-sounds without turning presentation state into
/// reminder state.
/// </summary>
internal sealed record TrackedNotification(
    NotificationOccurrence Occurrence,
    DateTimeOffset LastShownAt,
    bool ConfirmingDone = false);
