using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// The two writes a toast button can make: acknowledge an occurrence, or snooze
/// it. Nothing else.
///
/// <para><b>This is a deliberate, narrow exception to the rule in
/// <c>apps/desktop/CLAUDE.md</c></b> that the host never calls a domain API. It
/// exists because toast buttons that only open the flyout were judged not worth
/// having; the trade is that this is now a second caller of the ack/snooze
/// endpoints and has to stay faithful to them.</para>
///
/// <para>What keeps it faithful: it sends an id and (for snooze) a duration, and
/// takes the server's answer as final. It holds no occurrence state, decides
/// nothing about whether an action is allowed, and mirrors no status rules — the
/// server already rejects an ack on a terminal or not-yet-due occurrence with a
/// 409, and a rejection is simply reported. The one user-facing rule this surface
/// owns is the two-tap Done confirm (docs/notification-behavior.md §1), which is
/// implemented in <see cref="ToastNotifier"/> by replacing the toast rather than
/// by anything here.</para>
///
/// <para>The session cookie is borrowed from the WebView2 profile per call, so an
/// action taken after the session was refreshed uses the current cookie and one
/// taken after sign-out simply fails.</para>
/// </summary>
internal sealed class OccurrenceApi
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    private readonly Func<Task<string?>> _cookieProvider;
    private readonly Func<string> _serverUrlProvider;

    public OccurrenceApi(Func<Task<string?>> cookieProvider, Func<string> serverUrlProvider)
    {
        _cookieProvider = cookieProvider;
        _serverUrlProvider = serverUrlProvider;
    }

    /// <summary>Mark an occurrence done. Idempotent server-side, so a double-click
    /// or a retry is harmless.</summary>
    public Task<bool> AckAsync(string occurrenceId) =>
        PostAsync($"/api/occurrences/{Uri.EscapeDataString(occurrenceId)}/ack", null);

    /// <summary>Snooze an occurrence for <paramref name="minutes"/>.</summary>
    public Task<bool> SnoozeAsync(string occurrenceId, int minutes) =>
        PostAsync(
            $"/api/occurrences/{Uri.EscapeDataString(occurrenceId)}/snooze",
            $"{{\"minutes\":{minutes}}}");

    private async Task<bool> PostAsync(string path, string? jsonBody)
    {
        try
        {
            string? cookie = await _cookieProvider();
            if (string.IsNullOrEmpty(cookie))
            {
                Logger.Warn("Toast action skipped: no session cookie (signed out?)");
                return false;
            }

            using var request = new HttpRequestMessage(HttpMethod.Post, _serverUrlProvider() + path);
            request.Headers.Add("Cookie", cookie);
            request.Content = new StringContent(jsonBody ?? "{}", Encoding.UTF8);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            using var response = await Http.SendAsync(request);
            if (response.IsSuccessStatusCode) return true;

            // A 409 is the server refusing the action (already terminal, not yet
            // due) — its call to make, and the reason this client holds no rules of
            // its own about when an action is valid.
            Logger.Warn("Toast action {0} rejected with {1}", path, (int)response.StatusCode);
            return false;
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Toast action {0} failed", path);
            return false;
        }
    }
}
