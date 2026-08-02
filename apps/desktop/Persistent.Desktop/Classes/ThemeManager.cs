using Microsoft.UI.Xaml;
using Persistent.Desktop.Classes.Settings;

namespace Persistent.Desktop.Classes;

/// <summary>
/// Applies the selected app theme (WinUI 3 ElementTheme) to this app's own windows.
/// Scope is deliberately narrow — the flyout frame and the settings window. The
/// PWA inside the WebView renders its own theme (`settings/themes.ts`), so this
/// never tries to reach into web content.
/// </summary>
internal static class ThemeManager
{
    public static void ApplySavedTheme(Window window) => Apply(SettingsManager.Current.AppTheme, window);

    public static void ApplyAndSaveTheme(int theme)
    {
        SettingsManager.Current.AppTheme = theme;
        SettingsManager.SaveSettings();
        var settings = SettingsWindow.GetCurrent();
        if (settings != null) Apply(theme, settings);
        var flyout = Windows.AppFlyout.GetCurrent();
        if (flyout != null) Apply(theme, flyout);
    }

    private static void Apply(int theme, Window window)
    {
        var requested = theme switch { 1 => ElementTheme.Light, 2 => ElementTheme.Dark, _ => ElementTheme.Default };
        if (window.Content is FrameworkElement fe) fe.RequestedTheme = requested;
    }

    private static readonly global::Windows.UI.ViewManagement.UISettings s_uiSettings = new();

    public static bool IsDarkTheme()
    {
        int theme = SettingsManager.Current.AppTheme;
        if (theme == 1) return false;
        if (theme == 2) return true;
        var fg = s_uiSettings.GetColorValue(global::Windows.UI.ViewManagement.UIColorType.Foreground);
        return fg.R > 128;
    }
}
