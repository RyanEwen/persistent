namespace Persistent.Desktop.Services;

/// <summary>
/// What the tray icon knows about the user's reminders: how many are nagging, and
/// whether any of them has escalated.
///
/// The host never queries the API for this. The PWA already holds it — it has the
/// session, the TanStack caches and the live `/ws` socket — so it posts the count
/// over the WebView2 message channel (`apps/web/src/native/desktopBridge.ts`) and
/// this is where it lands. That is why the WebView is kept warm rather than being
/// built per flyout: a torn-down page has no socket, and a tray icon that only
/// knows the count while you are looking at the flyout is useless.
/// </summary>
internal static class TrayState
{
    /// <summary>Occurrences currently nagging (FIRED/ESCALATED/SNOOZED).</summary>
    public static int ActiveCount { get; private set; }

    /// <summary>At least one active occurrence has escalated — badge turns red.</summary>
    public static bool HasEscalation { get; private set; }

    /// <summary>False until the page has reported once, so a starting-up tray can
    /// say "connecting" rather than claiming a confident zero.</summary>
    public static bool HasReported { get; private set; }

    /// <summary>Raised on the UI thread whenever any of the above changes.</summary>
    public static event Action? Changed;

    public static void Report(int activeCount, bool hasEscalation)
    {
        int count = activeCount < 0 ? 0 : activeCount;
        if (HasReported && count == ActiveCount && hasEscalation == HasEscalation) return;
        ActiveCount = count;
        HasEscalation = hasEscalation;
        HasReported = true;
        Changed?.Invoke();
    }

    /// <summary>The page went away (navigation error, sign-out). Back to unknown.</summary>
    public static void Reset()
    {
        if (!HasReported && ActiveCount == 0 && !HasEscalation) return;
        ActiveCount = 0;
        HasEscalation = false;
        HasReported = false;
        Changed?.Invoke();
    }

    /// <summary>Tray tooltip text (Shell_NotifyIcon caps this at 127 chars).</summary>
    public static string Tooltip()
    {
        if (!HasReported) return "Persistent - connecting...";
        if (ActiveCount == 0) return "Persistent - nothing due";
        string noun = ActiveCount == 1 ? "reminder" : "reminders";
        return HasEscalation
            ? $"Persistent - {ActiveCount} {noun} due (escalated)"
            : $"Persistent - {ActiveCount} {noun} due";
    }
}
