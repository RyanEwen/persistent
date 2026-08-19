using CommunityToolkit.Mvvm.ComponentModel;
using System.Text.Json.Serialization;

namespace Persistent.Desktop.ViewModels;

/// <summary>
/// All user settings. Every <c>[ObservableProperty]</c> auto-serializes to
/// settings.json via <see cref="Classes.Settings.SettingsManager"/>. Side-effects
/// live in partial <c>On…Changed</c> methods guarded by <see cref="_initializing"/>.
///
/// Deliberately small: this app stores almost nothing, because the PWA it hosts
/// owns the account, the reminders and the display preferences. What lives here is
/// only what a *window* needs — where it sits, how it is themed, whether it starts
/// with Windows — plus which server to point the WebView at.
/// </summary>
public partial class UserSettings : ObservableObject
{
    /// <summary>Suppresses side-effects while deserializing.</summary>
    [JsonIgnore] private bool _initializing = true;

    /// <summary>The hosted Persistent instance the flyout loads. No trailing slash.</summary>
    [ObservableProperty] public partial string ServerUrl { get; set; } = DefaultServerUrl;

    public const string DefaultServerUrl = "https://persistent.dynamic-solutions.ca";

    // ── Flyout geometry ──────────────────────────────────────────────
    /// <summary>Flyout size in DIPs. The PWA is a single phone-width column
    /// (`AppLayout` caps its content at 640), so a narrow window is its natural
    /// shape rather than a compromise.</summary>
    [ObservableProperty] public partial int FlyoutWidth { get; set; } = 420;
    [ObservableProperty] public partial int FlyoutHeight { get; set; } = 680;

    /// <summary>Keep the flyout open when it loses focus (a pin, toggled from the
    /// flyout's own header). Off by default — a tray flyout should light-dismiss —
    /// but editing a reminder inside it shouldn't be interruptible by a stray click.</summary>
    [ObservableProperty] public partial bool PinFlyout { get; set; }

    // ── App ──────────────────────────────────────────────────────────
    /// <summary>0 = system, 1 = light, 2 = dark. Applies to this app's own chrome
    /// only; the PWA inside the WebView has its own theme setting.</summary>
    [ObservableProperty] public partial int AppTheme { get; set; }

    // No "start at sign-in" here, deliberately. Windows owns it (the MSIX startup
    // task, or the Run key unpackaged), the user can change it from Task Manager
    // behind our back, and <see cref="Classes.StartupManager"/> can read it whenever
    // it is needed. A stored copy would be a second answer that is wrong whenever
    // those two disagree. There *was* one, unread by anything and unable to survive
    // a round-trip: `WhenWritingDefault` omits a false from the file, so it read
    // back as the `true` initializer.

    [ObservableProperty] public partial string LastKnownVersion { get; set; } = "";

    // ── Notifications ────────────────────────────────────────────────
    /// <summary>Show Windows toasts for firings. <b>Off by default</b>, and per
    /// machine: this app is not the persistence guarantee (a sleeping PC shows
    /// nothing), so it must never be the thing a user assumes is watching for them.
    /// See <see cref="Notifications.NotificationService"/>.</summary>
    [ObservableProperty] public partial bool DesktopNotifications { get; set; }

    /// <summary>Which duration the toast's snooze picker starts on. The toast offers
    /// the full list (`ToastNotifier.SnoozeChoices`, mirroring the web's
    /// SNOOZE_PRESETS); this only decides the initial selection.</summary>
    [ObservableProperty] public partial int NotificationSnoozeMinutes { get; set; } = 10;

    /// <summary>
    /// False until the app has started once. Windows 11 files every new tray icon
    /// into the hidden overflow, so a first launch with no window looks exactly
    /// like a failed launch; the first run opens the flyout to prove otherwise.
    /// </summary>
    [ObservableProperty] public partial bool HasLaunchedBefore { get; set; }

    // ── Settings window geometry ─────────────────────────────────────
    [ObservableProperty] public partial int SettingsWindowX { get; set; }
    [ObservableProperty] public partial int SettingsWindowY { get; set; }
    [ObservableProperty] public partial int SettingsWindowWidth { get; set; }
    [ObservableProperty] public partial int SettingsWindowHeight { get; set; }

    /// <summary>`ServerUrl` with any trailing slash removed, falling back to the
    /// default when blank — what every navigation and link actually uses.</summary>
    [JsonIgnore]
    public string EffectiveServerUrl =>
        string.IsNullOrWhiteSpace(ServerUrl) ? DefaultServerUrl : ServerUrl.Trim().TrimEnd('/');

    // ── Side-effects ─────────────────────────────────────────────────
    partial void OnAppThemeChanged(int value)
    {
        if (_initializing) return;
        Classes.ThemeManager.ApplyAndSaveTheme(value);
    }

    partial void OnDesktopNotificationsChanged(bool value)
    {
        if (_initializing) return;
        // Connects or tears down the host's `/ws` connection and the toast
        // registration; turning it off also clears any toast already showing.
        Notifications.NotificationService.Sync();
    }

    /// <summary>Repairs nulls from older/partial files and ends the initializing window.</summary>
    public void CompleteInitialization()
    {
        ServerUrl ??= DefaultServerUrl;
        LastKnownVersion ??= "";
        if (FlyoutWidth < 320) FlyoutWidth = 420;
        if (FlyoutHeight < 400) FlyoutHeight = 680;
        // A settings file written before this setting existed deserializes it as 0,
        // which would start the toast's picker on nothing. 1440 (a day) is the
        // longest duration offered, matching ToastNotifier.SnoozeChoices.
        if (NotificationSnoozeMinutes is < 1 or > 1440) NotificationSnoozeMinutes = 10;
        _initializing = false;
    }
}
