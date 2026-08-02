using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.Services;
using System.Diagnostics;
using System.IO;

namespace Persistent.Desktop.Pages;

public sealed partial class AboutPage : Page
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private string? _releaseUrl;

    public AboutPage()
    {
        InitializeComponent();

        VersionText.Text = $"Version {UpdateService.CurrentVersion()}";
        try { AppIcon.Source = new BitmapImage(new Uri(App.IconImagePath)); } catch { /* cosmetic */ }

        SourceLink.NavigateUri = new Uri("https://github.com/RyanEwen/persistent");
        PrivacyLink.NavigateUri = new Uri($"{SettingsManager.Current.EffectiveServerUrl}/privacy");
    }

    private async void UpdateButton_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        // Second click, once an update was found: go to the release page.
        if (_releaseUrl != null)
        {
            UpdateService.OpenRelease(_releaseUrl);
            return;
        }

        UpdateButton.IsEnabled = false;
        UpdateStatus.Text = "Checking...";
        try
        {
            var result = await UpdateService.CheckAsync();
            if (result.Error != null)
            {
                UpdateStatus.Text = $"Couldn't check for updates ({result.Error})";
            }
            else if (result.UpdateAvailable && result.ReleaseUrl != null)
            {
                _releaseUrl = result.ReleaseUrl;
                UpdateStatus.Text = $"Version {result.LatestVersion} is available (you have {result.CurrentVersion}).";
                UpdateButton.Content = "View release";
            }
            else
            {
                UpdateStatus.Text = $"You're up to date (version {result.CurrentVersion}).";
            }
        }
        finally
        {
            UpdateButton.IsEnabled = true;
        }
    }

    private void LogsLink_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        string path = SettingsManager.AppDataDirectory;
        try
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not open the log folder");
        }
    }
}
