using Microsoft.Windows.Widgets.Providers;
using Persistent.WindowsWidget;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using static Persistent.Widget.NativeMethods;

namespace Persistent.Widget;

/// <summary>
/// Read-only Upcoming widget for the Windows 11 Widgets Board. The hosted web app
/// supplies a bounded, display-ready snapshot so selection, schedule calculations,
/// authentication and reminder actions retain one implementation.
/// </summary>
[ComVisible(true)]
[ComDefaultInterface(typeof(IWidgetProvider))]
[Guid("8C74E4F8-6D73-4D2D-92E8-CA3027DD1ED1")]
public sealed class PersistentWidgetProvider : IWidgetProvider
{
    public const string DefinitionId = "Persistent_Launcher_Widget";

    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();
    private static readonly ConcurrentDictionary<string, byte> Instances = new();
    internal static readonly ManualResetEvent EmptyWidgetListEvent = new(false);
    private static readonly Timer RefreshDebounce = new(_ => UpdateAll(), null, Timeout.Infinite, Timeout.Infinite);
    private static readonly FileSystemWatcher SnapshotWatcher = CreateSnapshotWatcher();
    private static readonly uint RefreshWidgetMessage = RegisterWindowMessage("Persistent_RefreshWidget");

    public PersistentWidgetProvider()
    {
        RecoverInstances();
        GC.KeepAlive(SnapshotWatcher);
    }

    /// <summary>Register a newly pinned widget and immediately supply its cached Upcoming card.</summary>
    public void CreateWidget(WidgetContext widgetContext)
    {
        if (widgetContext.DefinitionId != DefinitionId)
        {
            throw new ArgumentException($"Unknown widget definition: {widgetContext.DefinitionId}");
        }

        Instances[widgetContext.Id] = 0;
        EmptyWidgetListEvent.Reset();
        Update(widgetContext.Id);
        RequestFreshSnapshot();
        Logger.Info("Widget {0} created", widgetContext.Id);
    }

    /// <summary>Forget a widget after Windows removes it from the board.</summary>
    public void DeleteWidget(string widgetId, string customState)
    {
        Instances.TryRemove(widgetId, out _);
        if (Instances.IsEmpty) EmptyWidgetListEvent.Set();
        Logger.Info("Widget {0} deleted", widgetId);
    }

    /// <summary>Open the existing tray app when any card action is invoked.</summary>
    public void OnActionInvoked(WidgetActionInvokedArgs args)
    {
        if (args.Verb != "open")
        {
            Logger.Warn("Ignoring unknown widget action {0}", args.Verb);
            return;
        }

        try
        {
            string executable = Path.GetFullPath(Path.Combine(
                AppContext.BaseDirectory,
                "..",
                "Persistent.Desktop.exe"));
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not open Persistent from the widget");
        }
    }

    /// <summary>Re-send the responsive card after a board size change.</summary>
    public void OnWidgetContextChanged(WidgetContextChangedArgs args)
    {
        Update(args.WidgetContext.Id);
    }

    /// <summary>Show cached data immediately, then ask the resident tray app for a fresh snapshot.</summary>
    public void Activate(WidgetContext widgetContext)
    {
        Instances[widgetContext.Id] = 0;
        EmptyWidgetListEvent.Reset();
        Update(widgetContext.Id);
        RequestFreshSnapshot();
    }

    /// <summary>The filesystem watcher is process-wide, so one inactive instance needs no cleanup.</summary>
    public void Deactivate(string widgetId)
    {
    }

    /// <summary>Recover instances known to the broker after it starts a fresh provider process.</summary>
    private static void RecoverInstances()
    {
        try
        {
            foreach (var info in WidgetManager.GetDefault().GetWidgetInfos())
            {
                if (info.WidgetContext.DefinitionId == DefinitionId)
                {
                    Instances[info.WidgetContext.Id] = 0;
                }
            }
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not recover existing widgets");
        }
    }

    /// <summary>Watch atomic snapshot renames and coalesce duplicate filesystem events.</summary>
    private static FileSystemWatcher CreateSnapshotWatcher()
    {
        Directory.CreateDirectory(WidgetSnapshotStorage.AppDataDirectory);
        var watcher = new FileSystemWatcher(WidgetSnapshotStorage.AppDataDirectory, WidgetSnapshotStorage.FileName)
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            EnableRaisingEvents = true
        };
        watcher.Changed += OnSnapshotChanged;
        watcher.Created += OnSnapshotChanged;
        watcher.Renamed += OnSnapshotChanged;
        return watcher;
    }

    /// <summary>Delay briefly so an atomic rename and adjacent notifications settle.</summary>
    private static void OnSnapshotChanged(object sender, FileSystemEventArgs args)
    {
        RefreshDebounce.Change(100, Timeout.Infinite);
    }

    /// <summary>Update every pinned instance from the same locally stored snapshot.</summary>
    private static void UpdateAll()
    {
        foreach (string widgetId in Instances.Keys) Update(widgetId);
    }

    /// <summary>Send the latest card to one widget instance.</summary>
    private static void Update(string widgetId)
    {
        if (!Instances.ContainsKey(widgetId)) return;

        try
        {
            var update = new WidgetUpdateRequestOptions(widgetId)
            {
                Template = BuildTemplate(WidgetSnapshotStorage.Load()),
                Data = "{}",
                CustomState = string.Empty
            };
            WidgetManager.GetDefault().UpdateWidget(update);
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not update widget {0}", widgetId);
        }
    }

    /// <summary>
    /// Build app-like information hierarchy inside Windows-owned widget chrome.
    /// Small cards show two rows; medium cards show all four snapshot rows.
    /// </summary>
    private static string BuildTemplate(WidgetSnapshot snapshot)
    {
        var body = new JsonArray
        {
            Text("Upcoming", size: "large", weight: "bolder", color: "accent"),
            Text("Everything coming up, soonest first.", subtle: true, spacing: "none")
        };

        if (!snapshot.SignedIn)
        {
            body.Add(Text("Open Persistent and sign in to show your reminders here.", wrap: true, spacing: "large"));
        }
        else if (snapshot.Items.Count == 0)
        {
            body.Add(Text("Nothing scheduled. Anything due right now is on Current.", wrap: true, spacing: "large"));
        }
        else
        {
            body.Add(SmallReminderLayout(snapshot.Items));
            body.Add(MediumReminderLayout(snapshot.Items));
        }

        var card = new JsonObject
        {
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["type"] = "AdaptiveCard",
            ["version"] = "1.5",
            ["body"] = body,
            ["actions"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "Action.Execute",
                    ["title"] = snapshot.SignedIn ? "Open upcoming" : "Open Persistent",
                    ["verb"] = "open"
                }
            }
        };
        return card.ToJsonString();
    }

    /// <summary>Stack the first two concise rows in the square small card.</summary>
    private static JsonObject SmallReminderLayout(IReadOnlyList<WidgetReminderItem> items)
    {
        var rows = new JsonArray();
        for (int index = 0; index < Math.Min(items.Count, 2); index++)
        {
            rows.Add(ReminderRow(items[index], index > 0, includeDescription: false));
        }

        return new JsonObject
        {
            ["type"] = "Container",
            ["$when"] = "${$host.widgetSize==\"small\"}",
            ["items"] = rows
        };
    }

    /// <summary>Use the medium card's width for two columns of two reminders.</summary>
    private static JsonObject MediumReminderLayout(IReadOnlyList<WidgetReminderItem> items)
    {
        var columns = new JsonArray();
        for (int columnIndex = 0; columnIndex < 2; columnIndex++)
        {
            var rows = new JsonArray();
            int start = columnIndex * 2;
            for (int index = start; index < Math.Min(items.Count, start + 2); index++)
            {
                rows.Add(ReminderRow(items[index], index > start, includeDescription: true));
            }

            columns.Add(new JsonObject
            {
                ["type"] = "Column",
                ["width"] = "stretch",
                ["items"] = rows
            });
        }

        return new JsonObject
        {
            ["type"] = "ColumnSet",
            ["$when"] = "${$host.widgetSize==\"medium\"}",
            ["columns"] = columns
        };
    }

    /// <summary>Build one row with the same label, title and timing order as the PWA.</summary>
    private static JsonObject ReminderRow(
        WidgetReminderItem item,
        bool separator,
        bool includeDescription)
    {
        var rowItems = new JsonArray
        {
            Text(string.IsNullOrEmpty(item.Type) ? "REMINDER" : item.Type, size: "small", weight: "bolder", color: "accent"),
            Text(item.Title, weight: "bolder", spacing: "none", maxLines: 1)
        };
        if (includeDescription && !string.IsNullOrEmpty(item.Description))
        {
            rowItems.Add(Text(item.Description, subtle: true, spacing: "none", maxLines: 1));
        }
        rowItems.Add(Text(item.When, color: item.Paused ? "default" : "accent", spacing: "small", maxLines: 1));

        var row = new JsonObject
        {
            ["type"] = "Container",
            ["separator"] = separator,
            ["spacing"] = "medium",
            ["items"] = rowItems,
            ["selectAction"] = new JsonObject
            {
                ["type"] = "Action.Execute",
                ["verb"] = "open"
            }
        };
        return row;
    }

    /// <summary>Create one Adaptive Card text block while omitting unused optional properties.</summary>
    private static JsonObject Text(
        string value,
        string? size = null,
        string? weight = null,
        string? color = null,
        bool subtle = false,
        bool wrap = false,
        string? spacing = null,
        int? maxLines = null)
    {
        var text = new JsonObject { ["type"] = "TextBlock", ["text"] = value };
        if (size is not null) text["size"] = size;
        if (weight is not null) text["weight"] = weight;
        if (color is not null) text["color"] = color;
        if (subtle) text["isSubtle"] = true;
        if (wrap) text["wrap"] = true;
        if (spacing is not null) text["spacing"] = spacing;
        if (maxLines is not null) text["maxLines"] = maxLines;
        return text;
    }

    /// <summary>Ask the existing tray process to wake its authenticated WebView and refresh the snapshot.</summary>
    private static void RequestFreshSnapshot()
    {
        IntPtr host = FindWindow(null, "Persistent Host");
        if (host == IntPtr.Zero) return;
        if (!PostMessage(host, RefreshWidgetMessage, IntPtr.Zero, IntPtr.Zero))
        {
            Logger.Warn("Could not request a widget refresh from the tray host (Win32 {0})",
                Marshal.GetLastWin32Error());
        }
    }
}
