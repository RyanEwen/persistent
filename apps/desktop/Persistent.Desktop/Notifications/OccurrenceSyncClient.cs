using System.Net.Http;
using System.Text.Json;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// One recovery read. <c>Authorized</c> distinguishes an expired session from a
/// network failure, since only the former permits clearing personal content.
/// </summary>
internal sealed record OccurrenceSyncResult(
    bool Authorized,
    IReadOnlyList<NotificationOccurrence> Occurrences);

/// <summary>
/// Reads the server-computed device alarm list for startup, reconnect and resume
/// recovery. It deliberately consumes display-ready alarms instead of learning
/// reminder schedules, escalation rules, checklist formatting or status policy.
/// </summary>
internal sealed class OccurrenceSyncClient
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    private const string EscalationSuffix = "::esc";
    private const int MaxIdentifierLength = 512;
    private const int MaxTitleLength = 200;
    private const int MaxBodyLength = 4000;
    private const int MaxSoundIntervalSeconds = 31_536_000;

    private readonly Func<Task<string?>> _cookieProvider;
    private readonly Func<string> _serverUrlProvider;

    public OccurrenceSyncClient(Func<Task<string?>> cookieProvider, Func<string> serverUrlProvider)
    {
        _cookieProvider = cookieProvider;
        _serverUrlProvider = serverUrlProvider;
    }

    /// <summary>
    /// Return every notification that is due now, or <c>null</c> when sync failed.
    /// A failed read must never look like an empty set, because that would clear
    /// valid notifications while the network was merely unavailable.
    /// </summary>
    public async Task<OccurrenceSyncResult?> GetActiveAsync()
    {
        try
        {
            string? cookie = await _cookieProvider();
            if (string.IsNullOrEmpty(cookie))
            {
                Logger.Debug("Notification sync skipped: no session cookie");
                return null;
            }

            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                _serverUrlProvider() + "/api/sync/occurrences?alarmsOnly=true");
            request.Headers.Add("Cookie", cookie);

            using var response = await Http.SendAsync(request);
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                Logger.Info("Notification sync found an expired session");
                return new OccurrenceSyncResult(false, []);
            }
            if (!response.IsSuccessStatusCode)
            {
                Logger.Warn("Notification sync rejected with {0}", (int)response.StatusCode);
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync();
            using var document = await JsonDocument.ParseAsync(stream);
            return new OccurrenceSyncResult(true, ParseActive(document.RootElement));
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Notification sync failed");
            return null;
        }
    }

    /// <summary>
    /// Parse only alarms whose server-computed fire instant has arrived. A due
    /// <c>::esc</c> twin replaces its base notification as an alarm, matching the
    /// same device-alarm contract Android consumes.
    /// </summary>
    private static IReadOnlyList<NotificationOccurrence> ParseActive(JsonElement root)
    {
        long nowMs = ReadServerTimeMs(root);
        var active = new Dictionary<string, NotificationOccurrence>(StringComparer.Ordinal);

        if (!root.TryGetProperty("alarms", out var alarms) || alarms.ValueKind != JsonValueKind.Array)
        {
            throw new JsonException("Notification sync response has no alarms array.");
        }

        foreach (var alarm in alarms.EnumerateArray())
        {
            string alarmId = ReadString(alarm, "occurrenceId", MaxIdentifierLength);
            string reminderId = ReadString(alarm, "reminderId", MaxIdentifierLength);
            string title = ReadString(alarm, "title", MaxTitleLength);
            if (alarmId.Length == 0 || reminderId.Length == 0 || title.Length == 0) continue;

            if (!alarm.TryGetProperty("fireAtMs", out var fireAtElement)
                || !fireAtElement.TryGetInt64(out long fireAtMs)
                || fireAtMs > nowMs)
            {
                continue;
            }

            bool escalation = alarmId.EndsWith(EscalationSuffix, StringComparison.Ordinal);
            string occurrenceId = escalation ? alarmId[..^EscalationSuffix.Length] : alarmId;
            bool rings = escalation || ReadBool(alarm, "alarm");

            int soundIntervalSeconds = ReadInt(alarm, "soundIntervalSeconds");
            if (soundIntervalSeconds is < 0 or > MaxSoundIntervalSeconds)
            {
                soundIntervalSeconds = 0;
            }

            var occurrence = new NotificationOccurrence(
                occurrenceId,
                reminderId,
                title,
                ReadString(alarm, "body", MaxBodyLength),
                rings,
                escalation || ReadBool(alarm, "canSilence"),
                soundIntervalSeconds);

            // buildDeviceAlarms emits the base first and its escalation twin second,
            // so a due escalation intentionally upgrades the same occurrence here.
            active[occurrenceId] = occurrence;
        }

        return active.Values.ToArray();
    }

    private static long ReadServerTimeMs(JsonElement root)
    {
        string raw = ReadString(root, "serverTime", 64);
        return DateTimeOffset.TryParse(raw, out var serverTime)
            ? serverTime.ToUnixTimeMilliseconds()
            : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static string ReadString(JsonElement element, string property, int maxLength)
    {
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return "";
        }

        string result = value.GetString() ?? "";
        return result.Length <= maxLength ? result : result[..maxLength];
    }

    private static bool ReadBool(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value)
        && value.ValueKind is JsonValueKind.True or JsonValueKind.False
        && value.GetBoolean();

    private static int ReadInt(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt32(out int result)
            ? result
            : 0;
}
