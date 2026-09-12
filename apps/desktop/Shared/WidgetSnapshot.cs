using System.Text.Json;
using System.Text.Json.Serialization;

namespace Persistent.WindowsWidget;

/// <summary>
/// The intentionally narrow file contract between the authenticated WebView,
/// desktop host and widget provider. It contains display text only, never session
/// material or enough reminder state to reproduce scheduling rules in C#.
/// </summary>
public sealed record WidgetSnapshot
{
    public int Version { get; init; } = 1;
    public bool SignedIn { get; init; }
    public DateTimeOffset GeneratedAt { get; init; }
    public List<WidgetReminderItem> Items { get; init; } = [];
}

/// <summary>One display-ready row in the Windows widget.</summary>
public sealed record WidgetReminderItem
{
    public string Type { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string When { get; init; } = string.Empty;
    public bool Paused { get; init; }
}

/// <summary>Validates and atomically stores the widget snapshot shared by both processes.</summary>
public static class WidgetSnapshotStorage
{
    public const string FileName = "widget-snapshot.json";
    private const int ItemLimit = 4;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault
    };

    /// <summary>The per-Windows-user directory shared by the two packaged processes.</summary>
    public static string AppDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Persistent");

    public static string FilePath => Path.Combine(AppDataDirectory, FileName);

    /// <summary>
    /// Parse an untrusted page message and cap every field before it reaches the
    /// filesystem or Adaptive Card JSON. Returns false for an incompatible shape.
    /// </summary>
    public static bool TryParse(JsonElement element, out WidgetSnapshot snapshot)
    {
        snapshot = new WidgetSnapshot();

        try
        {
            var incoming = element.Deserialize<WidgetSnapshot>(JsonOptions);
            if (incoming is null || incoming.Version != 1) return false;
            if (incoming.Items is null || incoming.Items.Count > ItemLimit) return false;

            // A signed-out message is also the privacy cleanup path. Never retain
            // rows that a malformed or compromised page attaches to that state.
            if (!incoming.SignedIn)
            {
                snapshot = incoming with { Items = [] };
                return true;
            }

            var items = new List<WidgetReminderItem>(incoming.Items.Count);
            foreach (var item in incoming.Items)
            {
                string title = Clean(item.Title, 200);
                string when = Clean(item.When, 120);
                if (title.Length == 0 || when.Length == 0) return false;

                items.Add(item with
                {
                    Type = Clean(item.Type, 40),
                    Title = title,
                    Description = Clean(item.Description, 500),
                    When = when
                });
            }

            snapshot = incoming with
            {
                Items = items
            };
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>Write a validated snapshot using a same-directory atomic rename.</summary>
    public static void Save(WidgetSnapshot snapshot)
    {
        Directory.CreateDirectory(AppDataDirectory);
        string temporaryPath = Path.Combine(AppDataDirectory, $"{FileName}.{Guid.NewGuid():N}.tmp");

        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(snapshot, JsonOptions));
            File.Move(temporaryPath, FilePath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    /// <summary>
    /// Read the last complete snapshot. A missing file is the normal first-run
    /// state; malformed or unreadable content throws so the provider can log the
    /// operational failure instead of presenting a misleading signed-out card.
    /// </summary>
    public static WidgetSnapshot Load()
    {
        if (!File.Exists(FilePath)) return new WidgetSnapshot();

        using var document = JsonDocument.Parse(File.ReadAllText(FilePath));
        if (!TryParse(document.RootElement, out var snapshot))
        {
            throw new InvalidDataException("The widget snapshot has an unsupported shape or version.");
        }
        return snapshot;
    }

    /// <summary>Normalize whitespace and truncate one user-controlled card field.</summary>
    private static string Clean(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        string normalized = string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }
}
