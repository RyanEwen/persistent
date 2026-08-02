using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.ViewModels;
using Persistent.Desktop.Windows;

namespace Persistent.Desktop.Pages;

public sealed partial class ConnectionPage : Page
{
    public ConnectionPage()
    {
        InitializeComponent();
        ServerUrlBox.Text = SettingsManager.Current.EffectiveServerUrl;
    }

    private void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        string raw = (ServerUrlBox.Text ?? "").Trim().TrimEnd('/');
        if (raw.Length == 0)
        {
            Report("Enter an address, or reset to the default.");
            return;
        }
        // Require an absolute http(s) URL: anything else silently fails to load
        // later, inside the flyout, where the cause is far less obvious.
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            Report("That doesn't look like a web address. It should start with https://");
            return;
        }

        SettingsManager.Current.ServerUrl = raw;
        SettingsManager.SaveSettings();
        ServerUrlBox.Text = raw;

        AppFlyout.Reload();
        Report($"Saved. The flyout is loading {raw}.");
    }

    private void ResetButton_Click(object sender, RoutedEventArgs e)
    {
        SettingsManager.Current.ServerUrl = UserSettings.DefaultServerUrl;
        SettingsManager.SaveSettings();
        ServerUrlBox.Text = UserSettings.DefaultServerUrl;
        AppFlyout.Reload();
        Report("Reset to the default server.");
    }

    private async void SignOutButton_Click(object sender, RoutedEventArgs e)
    {
        var confirm = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Clear saved sign-in?",
            Content = "This PC will forget your session and its offline copy, and you'll sign in again next time. Your account and reminders are not affected.",
            PrimaryButtonText = "Clear",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close
        };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;

        bool cleared = await AppFlyout.ClearBrowsingDataAsync();
        Report(cleared
            ? "Signed out on this PC."
            : "Couldn't clear the saved session - try again once the flyout has finished loading.");
    }

    private void Report(string message)
    {
        SaveStatus.Text = message;
        SaveStatus.Visibility = Visibility.Visible;
    }
}
