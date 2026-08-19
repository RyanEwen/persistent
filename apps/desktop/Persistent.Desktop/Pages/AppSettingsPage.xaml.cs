using Microsoft.UI.Xaml.Controls;
using Persistent.Desktop.Classes;
using Persistent.Desktop.Classes.Settings;

namespace Persistent.Desktop.Pages;

/// <summary>
/// What is left of the native settings screen: the theme of this window, and a way
/// back to the app for everything else.
///
/// Windows notifications, the snooze default, start-at-sign-in, the flyout size and
/// the pin all live on the page's own Settings screen now
/// (<see cref="HostSettings"/>). The rule is which surface the setting describes:
/// this window's chrome is invisible to the page, and everything else describes
/// what the app does for the user, which is what they came to Settings for.
/// </summary>
public sealed partial class AppSettingsPage : Page
{
    private bool _loading = true;

    public AppSettingsPage()
    {
        InitializeComponent();
        ThemeCombo.SelectedIndex = Math.Clamp(SettingsManager.Current.AppTheme, 0, 2);
        _loading = false;
    }

    private void ThemeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading) return;
        ThemeManager.ApplyAndSaveTheme(ThemeCombo.SelectedIndex);
    }

    /// <summary>
    /// Open the flyout on its Settings screen. Navigated rather than just shown:
    /// the flyout reopens wherever the user left it, which is rarely the screen
    /// this button is pointing at.
    /// </summary>
    private void OpenAppSettingsButton_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        Windows.AppFlyout.Show();
        Windows.AppFlyout.NavigateTo("/settings");
    }
}
