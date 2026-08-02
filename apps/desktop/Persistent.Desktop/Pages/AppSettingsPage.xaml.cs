using Microsoft.UI.Xaml.Controls;
using Persistent.Desktop.Classes;
using Persistent.Desktop.Classes.Settings;

namespace Persistent.Desktop.Pages;

public sealed partial class AppSettingsPage : Page
{
    private const int DefaultWidth = 420, DefaultHeight = 680;

    private bool _loading = true;

    public AppSettingsPage()
    {
        InitializeComponent();
        var settings = SettingsManager.Current;
        ThemeCombo.SelectedIndex = Math.Clamp(settings.AppTheme, 0, 2);
        // Reflect the real OS startup state, not just the stored flag, so the toggle
        // stays truthful even if the user changed it in Task Manager.
        StartupToggle.IsOn = StartupManager.IsEnabled();
        PinToggle.IsOn = settings.PinFlyout;
        UpdateSizeSummary();
        _loading = false;
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

    private void ResetSizeButton_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        var settings = SettingsManager.Current;
        settings.FlyoutWidth = DefaultWidth;
        settings.FlyoutHeight = DefaultHeight;
        SettingsManager.SaveSettings();
        UpdateSizeSummary();
    }

    private void UpdateSizeSummary()
    {
        var settings = SettingsManager.Current;
        SizeSummary.Text =
            $"Currently {settings.FlyoutWidth} x {settings.FlyoutHeight}. Drag the flyout's edges to resize it; it reopens at the size you left it.";
    }
}
