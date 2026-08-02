using Persistent.Desktop.ViewModels;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Persistent.Desktop.Classes.Settings;

/// <summary>
/// Manages app settings, serialized as JSON to <c>%AppData%\Persistent\settings.json</c>.
/// Holds no credentials: the session cookie lives in the WebView2 user-data folder,
/// which is the browser's own encrypted store, so this file is not sensitive.
/// </summary>
public static class SettingsManager
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    /// <summary>Per-user app data root. Redirects to package-local AppData when packaged.</summary>
    public static string AppDataDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Persistent");

    public static string SettingsFilePath => Path.Combine(AppDataDirectory, "settings.json");

    /// <summary>
    /// Where WebView2 keeps its profile — cookies, localStorage, the service worker
    /// and its caches. This is what makes the app stay signed in across restarts and
    /// render offline, so it must be a stable per-user path, never a temp folder.
    /// </summary>
    public static string WebViewDataDirectory => Path.Combine(AppDataDirectory, "WebView2");

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault,
        PropertyNamingPolicy = null, // PascalCase to match property names
    };

    private static UserSettings _current = new();

    public static UserSettings Current
    {
        get => _current ??= new UserSettings();
        set => _current = value;
    }

    public static UserSettings RestoreSettings(string? filePath = null)
    {
        filePath ??= SettingsFilePath;
        try
        {
            if (File.Exists(filePath))
            {
                string json = File.ReadAllText(filePath);
                var deserialized = JsonSerializer.Deserialize<UserSettings>(json, JsonOptions);
                if (deserialized != null)
                {
                    _current = deserialized;
                    _current.CompleteInitialization();
                    Logger.Info("Settings restored");
                    return _current;
                }
            }
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Error restoring settings");
        }

        Logger.Warn("Settings not found or unreadable - loading defaults");
        _current = new UserSettings();
        _current.CompleteInitialization();
        return _current;
    }

    public static void SaveSettings(string? filePath = null)
    {
        filePath ??= SettingsFilePath;
        try
        {
            string? directory = Path.GetDirectoryName(filePath);
            if (directory != null && !Directory.Exists(directory))
                Directory.CreateDirectory(directory);

            string json = JsonSerializer.Serialize(_current, JsonOptions);
            File.WriteAllText(filePath, json);
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Error saving settings");
        }
    }
}
