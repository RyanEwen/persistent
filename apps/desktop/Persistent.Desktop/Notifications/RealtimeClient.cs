using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// One event from the server's `/ws` channel, flattened to only what a toast
/// needs. The full contract is `packages/shared/src/ws-events.ts`; this reads a
/// deliberately tiny slice of it and ignores everything else.
///
/// <para>It carries no reminder model, no schedule and no status rules — just an
/// id to act on and the text to display. Anything richer would be the C# mirror
/// of <c>@persistent/shared</c> that <c>apps/desktop/CLAUDE.md</c> exists to
/// prevent.</para>
/// </summary>
internal sealed record RealtimeEvent(
    string Type,
    string OccurrenceId,
    string ReminderId,
    string Title,
    string Body,
    string Status)
{
    /// <summary>An escalated occurrence is currently ringing an alarm elsewhere.</summary>
    public bool IsEscalated => Status == "ESCALATED";
}

/// <summary>
/// A host-owned connection to the per-user `/ws` channel, used only to decide
/// when to raise a Windows toast.
///
/// <para><b>Why the host connects at all.</b> The page has its own socket, but the
/// WebView is suspended whenever the flyout is hidden
/// (<c>AppFlyout.SetWebViewIdle</c>), which freezes its JavaScript and drops that
/// socket. A notification that could only arrive while the flyout was already open
/// would be useless. This connection is independent, so the suspend optimization
/// survives untouched.</para>
///
/// <para><b>Auth.</b> `/ws` authenticates from the session cookie during the HTTP
/// upgrade (`apps/api/src/lib/ws-hub.ts`), so this borrows the cookie out of the
/// WebView2 profile rather than holding any credential of its own. If the user is
/// signed out there is no cookie, the connect fails, and the loop simply keeps
/// retrying until they sign in.</para>
///
/// <para>Reconnects with backoff forever while enabled: a laptop that sleeps, a
/// dropped Wi-Fi link and a server restart all look the same from here, and all
/// want the same answer.</para>
/// </summary>
internal sealed class RealtimeClient : IDisposable
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    /// <summary>Backoff bounds for reconnecting. Capped low enough that waking a
    /// laptop doesn't leave the user without notifications for minutes.</summary>
    private static readonly TimeSpan MinRetry = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan MaxRetry = TimeSpan.FromSeconds(60);

    private readonly Func<Task<string?>> _cookieProvider;
    private readonly Func<string> _serverUrlProvider;

    private CancellationTokenSource? _cts;
    private Task? _loop;

    public event Action<RealtimeEvent>? EventReceived;

    public RealtimeClient(Func<Task<string?>> cookieProvider, Func<string> serverUrlProvider)
    {
        _cookieProvider = cookieProvider;
        _serverUrlProvider = serverUrlProvider;
    }

    public bool IsRunning => _loop is { IsCompleted: false };

    public void Start()
    {
        if (IsRunning) return;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cts.Token));
        Logger.Info("Realtime client started");
    }

    public void Stop()
    {
        try
        {
            _cts?.Cancel();
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Cancelling the realtime client failed");
        }
        _cts = null;
        _loop = null;
        Logger.Info("Realtime client stopped");
    }

    private async Task RunAsync(CancellationToken token)
    {
        var retry = MinRetry;
        while (!token.IsCancellationRequested)
        {
            try
            {
                await ConnectAndPumpAsync(token);
                // A clean close is normal (server restart, session expiry): reset the
                // backoff so the next attempt is prompt rather than inheriting a long
                // delay from an unrelated earlier failure.
                retry = MinRetry;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                // Debug, not Warn: being disconnected is the expected state on a
                // laptop that sleeps or a machine that is offline, and logging it
                // loudly every retry would bury the entries that matter.
                Logger.Debug(ex, "Realtime connection dropped; will retry in {0}s", retry.TotalSeconds);
            }

            try
            {
                await Task.Delay(retry, token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            retry = TimeSpan.FromSeconds(Math.Min(MaxRetry.TotalSeconds, retry.TotalSeconds * 2));
        }
    }

    private async Task ConnectAndPumpAsync(CancellationToken token)
    {
        string? cookieHeader = await _cookieProvider();
        if (string.IsNullOrEmpty(cookieHeader))
        {
            // Signed out, or the WebView hasn't finished starting. Not an error.
            throw new InvalidOperationException("No session cookie available yet.");
        }

        var uri = BuildSocketUri(_serverUrlProvider());
        using var socket = new ClientWebSocket();
        // SetRequestHeader rather than Options.Cookies: the cookie already arrives
        // fully formed from the browser profile, and re-parsing it into a
        // CookieContainer only adds a way to mangle it.
        socket.Options.SetRequestHeader("Cookie", cookieHeader);
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);

        await socket.ConnectAsync(uri, token);
        Logger.Info("Realtime connected to {0}", uri);

        var buffer = new byte[16 * 1024];
        var message = new StringBuilder();

        while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                return;
            }

            message.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            if (!result.EndOfMessage) continue;

            var json = message.ToString();
            message.Clear();
            Dispatch(json);
        }
    }

    /// <summary>`https://host` -> `wss://host/ws`. Anything unparseable throws and
    /// the retry loop handles it, rather than silently never connecting.</summary>
    private static Uri BuildSocketUri(string serverUrl)
    {
        var http = new Uri(serverUrl, UriKind.Absolute);
        var scheme = http.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        return new UriBuilder(scheme, http.Host, http.IsDefaultPort ? -1 : http.Port, "/ws").Uri;
    }

    /// <summary>
    /// Parse one event and raise it. Reads only the handful of fields a toast
    /// needs and tolerates anything else — the server is free to add event types
    /// and occurrence fields without this having to know.
    /// </summary>
    private void Dispatch(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeElement)) return;
            var type = typeElement.GetString();
            if (string.IsNullOrEmpty(type) || type == "ping" || type == "reminder.changed") return;

            if (type is "dismiss" or "silence")
            {
                var id = root.TryGetProperty("occurrenceId", out var occ) ? occ.GetString() : null;
                if (string.IsNullOrEmpty(id)) return;
                EventReceived?.Invoke(new RealtimeEvent(type, id, "", "", "", ""));
                return;
            }

            if (type is not ("occurrence.fired" or "occurrence.changed")) return;
            if (!root.TryGetProperty("occurrence", out var occurrence)) return;

            string occurrenceId = GetString(occurrence, "id");
            if (occurrenceId.Length == 0) return;
            string reminderId = GetString(occurrence, "reminderId");
            string status = GetString(occurrence, "status");

            string title = "";
            string body = "";
            if (occurrence.TryGetProperty("reminder", out var reminder))
            {
                title = GetString(reminder, "title");
                // Only `details` — deliberately not the medication doses or checklist
                // items. Rendering those is `reminderBodyText` in @persistent/shared,
                // and re-implementing it here is exactly the duplication this app is
                // built to avoid. The full body is one click away in the flyout.
                body = GetString(reminder, "details");
            }
            if (title.Length == 0) return;

            EventReceived?.Invoke(new RealtimeEvent(type, occurrenceId, reminderId, title, body, status));
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Ignoring an unparseable realtime event");
        }
    }

    private static string GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    public void Dispose() => Stop();
}
