using System.Text.Json;

namespace Persistent.Desktop.Classes.Settings;

/// <summary>
/// The settings this app presents inside the hosted PWA rather than in a native
/// window, and the whole of the translation between them and settings.json.
///
/// The settings that describe what the app DOES for the user - Windows toasts,
/// how large the flyout opens, whether it stays open, whether it starts with
/// Windows - are shown by the page's own Settings screen, so the product has one
/// Settings screen instead of two with different chrome that a user has to learn
/// to tell apart. <see cref="Windows.AppFlyout"/> owns the transport; the page
/// side is `apps/web/src/native/desktop-settings/`.
///
/// Two things deliberately do NOT come through here. The server address stays
/// native, because a control for the setting that decides whether the page loads
/// cannot live inside that page. And anything about a reminder stays in the PWA
/// outright (`apps/desktop/CLAUDE.md`) - this carries host state only, never a
/// schedule, a status or a done/snooze rule.
/// </summary>
internal static class HostSettings
{
    /// <summary>
    /// Fixed sizes rather than a drag-to-resize window. The flyout cannot be
    /// resizable: a resizable window keeps a Win32 sizing frame even when the
    /// presenter is asked for no border, and that frame is non-client area the app
    /// cannot paint (it showed as a pale strip along the top edge).
    ///
    /// Sent to the page rather than duplicated there, so the dimensions stay a host
    /// concern: this app can change or add a preset without needing a matching web
    /// release, and the page renders whatever it is handed.
    /// </summary>
    internal static readonly (string Id, string Label, int Width, int Height)[] FlyoutPresets =
    [
        ("compact", "Compact", 380, 560),
        ("standard", "Standard", 420, 680),
        ("tall", "Tall", 460, 820)
    ];

    private const int DefaultPresetIndex = 1;

    /// <summary>
    /// The parts of an applied patch that need a window to act on them, reported
    /// back rather than acted on here so this class stays free of XAML types (and
    /// so stays inside the Linux compile-check).
    /// </summary>
    internal readonly record struct Applied(bool FlyoutSizeChanged, bool PinChanged);

    /// <summary>
    /// The `hostSettings` message: every setting the page may show, plus the size
    /// presets it should offer. Sent in reply to `getHostSettings`, after any
    /// write, and whenever the host itself changes one of these.
    /// </summary>
    internal static async Task<string> BuildMessageJsonAsync()
    {
        var settings = SettingsManager.Current;

        // Asked of Windows, and never stored: a user can turn the app off in Task
        // Manager, so the only truthful answer is the live one. Nothing here keeps a
        // copy, because a copy is a second answer that can be wrong.
        bool startAtSignIn = await StartupManager.IsEnabledAsync();

        return JsonSerializer.Serialize(new
        {
            type = "hostSettings",
            settings = new
            {
                notifications = settings.DesktopNotifications,
                // Snapped to a duration a toast can actually start on, so the
                // settings screen never claims one the notification will not use.
                snoozeMinutes = Notifications.ToastNotifier.NearestOffered(settings.NotificationSnoozeMinutes),
                snoozeChoices = Notifications.ToastNotifier.OfferedSnoozeChoices
                    .Select(choice => new { minutes = choice.Minutes, label = choice.Label })
                    .ToArray(),
                pinFlyout = settings.PinFlyout,
                startAtSignIn,
                flyoutSize = CurrentPresetId(),
                flyoutSizes = FlyoutPresets
                    .Select(preset => new { id = preset.Id, label = preset.Label, width = preset.Width, height = preset.Height })
                    .ToArray()
            }
        });
    }

    /// <summary>
    /// Apply a partial patch from the page, then save.
    ///
    /// Every field is optional and every value is validated rather than trusted:
    /// this arrives from web content, which is not a privileged caller even though
    /// it is our own origin. An unrecognised or out-of-range value is dropped, and
    /// the reply the caller posts afterwards tells the page what actually stuck.
    /// </summary>
    internal static async Task<Applied> ApplyAsync(JsonElement patch)
    {
        if (patch.ValueKind != JsonValueKind.Object) return default;

        var settings = SettingsManager.Current;
        bool sizeChanged = false, pinChanged = false;

        if (TryGetBool(patch, "notifications", out bool notifications))
        {
            // The side-effect connects or tears down the `/ws` client and the toast
            // registration (UserSettings.OnDesktopNotificationsChanged).
            settings.DesktopNotifications = notifications;
        }

        // Accepted only if a toast can actually start on it. Windows caps a toast's
        // combo box at five items, so the picker is a subset of the app's own snooze
        // list and anything outside it would be silently corrected at notify time
        // (`ToastNotifier.OfferedSnoozeChoices`).
        if (patch.TryGetProperty("snoozeMinutes", out var snooze) && snooze.ValueKind == JsonValueKind.Number
            && snooze.TryGetInt32(out int minutes)
            && Array.Exists(Notifications.ToastNotifier.OfferedSnoozeChoices, choice => choice.Minutes == minutes))
        {
            settings.NotificationSnoozeMinutes = minutes;
        }

        if (TryGetBool(patch, "pinFlyout", out bool pinned))
        {
            pinChanged = pinned != settings.PinFlyout;
            settings.PinFlyout = pinned;
        }

        if (patch.TryGetProperty("flyoutSize", out var size) && size.ValueKind == JsonValueKind.String)
        {
            string? id = size.GetString();
            int index = Array.FindIndex(FlyoutPresets, preset => preset.Id == id);
            if (index >= 0)
            {
                var preset = FlyoutPresets[index];
                sizeChanged = preset.Width != settings.FlyoutWidth || preset.Height != settings.FlyoutHeight;
                settings.FlyoutWidth = preset.Width;
                settings.FlyoutHeight = preset.Height;
            }
        }

        if (TryGetBool(patch, "startAtSignIn", out bool startAtSignIn))
        {
            // Awaited rather than fired and forgotten, because Windows can refuse an
            // enable outright: a user who turned the app off in Task Manager leaves
            // the startup task DisabledByUser, and RequestEnableAsync cannot override
            // that. The result is not stored, only reported back by the reply this
            // caller posts next, which reads the live state again.
            await StartupManager.SetRunAtStartupAsync(startAtSignIn);
        }

        SettingsManager.SaveSettings();
        return new Applied(sizeChanged, pinChanged);
    }

    private static bool TryGetBool(JsonElement patch, string name, out bool value)
    {
        if (patch.TryGetProperty(name, out var element) && element.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            value = element.GetBoolean();
            return true;
        }
        value = false;
        return false;
    }

    /// <summary>The preset matching the stored size, or Standard if it matches none.</summary>
    private static string CurrentPresetId()
    {
        var settings = SettingsManager.Current;
        foreach (var preset in FlyoutPresets)
        {
            if (preset.Width == settings.FlyoutWidth && preset.Height == settings.FlyoutHeight) return preset.Id;
        }
        return FlyoutPresets[DefaultPresetIndex].Id;
    }
}
