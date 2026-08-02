using Microsoft.UI.Xaml.Controls;
using Persistent.Desktop.Classes;
using Persistent.Desktop.Classes.Settings;

namespace Persistent.Desktop.Pages;

public sealed partial class AppSettingsPage : Page
{
    /// <summary>
    /// Fixed sizes rather than a drag-to-resize window. The flyout cannot be
    /// resizable: a resizable window keeps a Win32 sizing frame even when the
    /// presenter is asked for no border, and that frame is non-client area the app
    /// cannot paint (it showed as a pale strip along the top edge).
    /// </summary>
    private static readonly (string Label, int Width, int Height)[] Presets =
    [
        ("Compact", 380, 560),
        ("Standard", 420, 680),
        ("Tall", 460, 820)
    ];

    private const int DefaultPreset = 1;

    /// <summary>Snooze durations the toast button can offer, in minutes.</summary>
    private static readonly int[] SnoozePresets = [5, 10, 30, 60];

    private bool _loading = true;

    public AppSettingsPage()
    {
        InitializeComponent();
        var settings = SettingsManager.Current;
        ThemeCombo.SelectedIndex = Math.Clamp(settings.AppTheme, 0, 2);
        // Reflect the real OS startup state, not just the stored flag, so the toggle
        // stays truthful even if the user changed it in Task Manager.
        StartupToggle.IsOn = StartupManager.IsEnabled();
        NotificationsToggle.IsOn = settings.DesktopNotifications;
        int snoozeIndex = Array.IndexOf(SnoozePresets, settings.NotificationSnoozeMinutes);
        SnoozeCombo.SelectedIndex = snoozeIndex >= 0 ? snoozeIndex : 1;
        UpdateSnoozeRowState();
        PinToggle.IsOn = settings.PinFlyout;
        SizeCombo.SelectedIndex = CurrentPresetIndex();
        UpdateSizeSummary();
        _loading = false;
    }

    private void NotificationsToggle_Toggled(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        if (_loading) return;
        // The side-effect on the setting connects or tears down the `/ws` client and
        // the toast registration (UserSettings.OnDesktopNotificationsChanged).
        SettingsManager.Current.DesktopNotifications = NotificationsToggle.IsOn;
        SettingsManager.SaveSettings();
        UpdateSnoozeRowState();
    }

    private void SnoozeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        int index = Math.Clamp(SnoozeCombo.SelectedIndex, 0, SnoozePresets.Length - 1);
        SettingsManager.Current.NotificationSnoozeMinutes = SnoozePresets[index];
        SettingsManager.SaveSettings();
    }

    /// <summary>The snooze duration only means anything while notifications are on.</summary>
    private void UpdateSnoozeRowState()
    {
        SnoozeRow.Opacity = NotificationsToggle.IsOn ? 1 : 0.4;
        SnoozeCombo.IsEnabled = NotificationsToggle.IsOn;
    }

    private void ThemeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        ThemeManager.ApplyAndSaveTheme(ThemeCombo.SelectedIndex);
    }

    private void StartupToggle_Toggled(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        if (_loading) return;
        SettingsManager.Current.Startup = StartupToggle.IsOn; // side-effect sets the startup task / Run key
        SettingsManager.SaveSettings();
    }

    private void PinToggle_Toggled(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        if (_loading) return;
        SettingsManager.Current.PinFlyout = PinToggle.IsOn;
        SettingsManager.SaveSettings();
        // The flyout's own pin button reads the same setting, so keep it in step.
        Windows.AppFlyout.SyncPinState();
    }

    private void SizeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        int index = Math.Clamp(SizeCombo.SelectedIndex, 0, Presets.Length - 1);
        var settings = SettingsManager.Current;
        settings.FlyoutWidth = Presets[index].Width;
        settings.FlyoutHeight = Presets[index].Height;
        SettingsManager.SaveSettings();
        UpdateSizeSummary();
    }

    /// <summary>The preset matching the stored size, or Standard if it matches none.</summary>
    private static int CurrentPresetIndex()
    {
        var settings = SettingsManager.Current;
        for (int i = 0; i < Presets.Length; i++)
        {
            if (Presets[i].Width == settings.FlyoutWidth && Presets[i].Height == settings.FlyoutHeight) return i;
        }
        return DefaultPreset;
    }

    private void UpdateSizeSummary()
    {
        var settings = SettingsManager.Current;
        SizeSummary.Text = $"How large the reminders flyout opens. Currently {settings.FlyoutWidth} x {settings.FlyoutHeight}.";
    }
}
