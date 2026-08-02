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

    /// <summary>Launch at sign-in. On by default: a tray app the user has to start
    /// by hand is a tray app that is not running when a reminder fires.</summary>
    [ObservableProperty] public partial bool Startup { get; set; } = true;

    [ObservableProperty] public partial string LastKnownVersion { get; set; } = "";

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

    partial void OnStartupChanged(bool value)
    {
        if (_initializing) return;
        Classes.StartupManager.SetRunAtStartup(value);
    }

    /// <summary>Repairs nulls from older/partial files and ends the initializing window.</summary>
    public void CompleteInitialization()
    {
        ServerUrl ??= DefaultServerUrl;
        LastKnownVersion ??= "";
        if (FlyoutWidth < 320) FlyoutWidth = 420;
        if (FlyoutHeight < 400) FlyoutHeight = 680;
        _initializing = false;
    }
}
