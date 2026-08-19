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

    /// <summary>What the button will do when clicked next.</summary>
    private enum UpdateAction
    {
        Check,
        /// <summary>Portable build: open the GitHub release page.</summary>
        OpenRelease,
        /// <summary>Packaged build: hand the install to the Store.</summary>
        Install,
        /// <summary>Packaged build: an update is staged and needs the app to exit.</summary>
        Restart,
    }

    private UpdateAction _action = UpdateAction.Check;
    private string? _releaseUrl;

    public AboutPage()
    {
        InitializeComponent();

        VersionText.Text = $"Version {UpdateService.CurrentVersion()}";
        try { AppIcon.Source = new BitmapImage(new Uri(App.IconImagePath)); } catch { /* cosmetic */ }

        // Says where an update would come from, which differs by install type and is
        // the difference between "download a zip yourself" and "the Store does it".
        UpdateStatus.Text = UpdateService.IsPackaged
            ? "Installed from the Microsoft Store, which handles updates. Nothing runs in the background."
            : "Checks GitHub releases when you ask it to. Nothing runs in the background.";

        SourceLink.NavigateUri = new Uri("https://github.com/RyanEwen/persistent");
        PrivacyLink.NavigateUri = new Uri($"{SettingsManager.Current.EffectiveServerUrl}/privacy");
    }

    private async void UpdateButton_Click(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        switch (_action)
        {
            case UpdateAction.OpenRelease:
                if (_releaseUrl != null) UpdateService.OpenRelease(_releaseUrl);
                return;

            case UpdateAction.Install:
                await InstallStoreUpdateAsync();
                return;

            case UpdateAction.Restart:
                UpdateService.RestartToApplyPackagedUpdate();
                MainWindow.RequestExit();
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
            else if (result.UpdateAvailable && result.IsStoreManaged)
            {
                // LatestVersion is empty when the Store lists an update but the catalog
                // lookup could not say which version it is. Word it without a number
                // rather than inventing one.
                UpdateStatus.Text = result.LatestVersion.Length > 0
                    ? $"Version {result.LatestVersion} is available (you have {result.CurrentVersion})."
                    : $"An update is available (you have {result.CurrentVersion}).";
                _action = UpdateAction.Install;
                UpdateButton.Content = "Download & install";
            }
            else if (result.UpdateAvailable && result.ReleaseUrl != null)
            {
                _releaseUrl = result.ReleaseUrl;
                UpdateStatus.Text = $"Version {result.LatestVersion} is available (you have {result.CurrentVersion}).";
                _action = UpdateAction.OpenRelease;
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

    private async Task InstallStoreUpdateAsync()
    {
        UpdateButton.IsEnabled = false;
        UpdateStatus.Text = "Downloading...";
        UpdateProgress.Visibility = Microsoft.UI.Xaml.Visibility.Visible;
        UpdateProgress.Value = 0;

        // The Store raises its own dialogs and needs an owner window; this page is
        // hosted in the settings window, so that is the one to hand it.
        nint owner = 0;
        var host = SettingsWindow.GetCurrent();
        if (host != null) owner = WinRT.Interop.WindowNative.GetWindowHandle(host);

        var progress = new Progress<double>(value => UpdateProgress.Value = value);

        try
        {
            var (success, message, restartMayHelp) = await UpdateService.DownloadAndInstallStoreUpdateAsync(owner, progress);
            UpdateStatus.Text = message;

            if (success)
            {
                // The package cannot be replaced while this process is alive, so the
                // last step of installing is leaving.
                UpdateButton.Content = "Restarting...";
                await Task.Delay(TimeSpan.FromSeconds(2));
                MainWindow.RequestExit();
                return;
            }

            if (restartMayHelp)
            {
                _action = UpdateAction.Restart;
                UpdateButton.Content = "Restart now";
            }
            else
            {
                // A real failure (cancelled, low battery, metered connection). Leave
                // the button where it started so another check is one click away.
                _action = UpdateAction.Check;
                UpdateButton.Content = "Check for updates";
            }
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Store update failed");
            UpdateStatus.Text = $"Update failed: {ex.Message}";
            _action = UpdateAction.Check;
            UpdateButton.Content = "Check for updates";
        }
        finally
        {
            UpdateProgress.Visibility = Microsoft.UI.Xaml.Visibility.Collapsed;
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
