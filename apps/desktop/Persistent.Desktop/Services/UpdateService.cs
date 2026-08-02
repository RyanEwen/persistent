using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json.Serialization;

namespace Persistent.Desktop.Services;

/// <summary>
/// Manual update check against this repo's GitHub Releases. Runs only when the
/// user clicks "Check for updates" on the About page — there is no automatic or
/// background network activity. Store-installed copies update through the
/// Microsoft Store instead, so this mainly serves sideloaded MSIX installs.
///
/// Desktop releases are tagged `desktop-vX.Y.Z` so they don't collide with the
/// Android `vX.Y.Z` tags in the same repository, which is why this reads the
/// release list rather than `releases/latest` (that endpoint returns the newest
/// release of *any* kind, which for this repo is usually an Android build).
/// </summary>
public static class UpdateService
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private const string Owner = "RyanEwen";
    private const string Repo = "persistent";
    public const string TagPrefix = "desktop-v";

    private static readonly Uri ReleasesUri = new($"https://api.github.com/repos/{Owner}/{Repo}/releases?per_page=30");

    private static readonly HttpClient Http = CreateHttpClient();

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"Persistent.Desktop/{CurrentVersion()}");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public sealed class UpdateCheckResult
    {
        public bool UpdateAvailable { get; init; }
        public string CurrentVersion { get; init; } = "";
        public string LatestVersion { get; init; } = "";
        public string? ReleaseUrl { get; init; }
        /// <summary>Set when the check could not complete (offline, rate-limited).</summary>
        public string? Error { get; init; }
    }

    private sealed class GithubRelease
    {
        [JsonPropertyName("tag_name")] public string? TagName { get; set; }
        [JsonPropertyName("html_url")] public string? HtmlUrl { get; set; }
        [JsonPropertyName("draft")] public bool Draft { get; set; }
        [JsonPropertyName("prerelease")] public bool Prerelease { get; set; }
    }

    public static string CurrentVersion()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version;
        return version == null ? "0.0.0" : $"{version.Major}.{version.Minor}.{version.Build}";
    }

    public static async Task<UpdateCheckResult> CheckAsync(CancellationToken ct = default)
    {
        string current = CurrentVersion();
        try
        {
            var releases = await Http.GetFromJsonAsync<List<GithubRelease>>(ReleasesUri, ct);
            var newest = releases?
                .Where(r => !r.Draft && !r.Prerelease && r.TagName?.StartsWith(TagPrefix, StringComparison.OrdinalIgnoreCase) == true)
                .Select(r => new { Release = r, Version = ParseVersion(r.TagName![TagPrefix.Length..]) })
                .Where(x => x.Version != null)
                .OrderByDescending(x => x.Version)
                .FirstOrDefault();

            // No desktop release published yet — that is "up to date", not an error.
            if (newest == null) return new UpdateCheckResult { CurrentVersion = current, LatestVersion = current };

            var running = ParseVersion(current);
            bool newer = running != null && newest.Version! > running;
            return new UpdateCheckResult
            {
                UpdateAvailable = newer,
                CurrentVersion = current,
                LatestVersion = newest.Version!.ToString(),
                ReleaseUrl = newest.Release.HtmlUrl
            };
        }
        catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            // No releases endpoint / no releases at all.
            return new UpdateCheckResult { CurrentVersion = current, LatestVersion = current };
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Update check failed");
            return new UpdateCheckResult { CurrentVersion = current, LatestVersion = current, Error = ex.Message };
        }
    }

    private static Version? ParseVersion(string raw) =>
        Version.TryParse(raw.Trim().TrimStart('v', 'V'), out var parsed) ? parsed : null;

    public static void OpenRelease(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not open the release page");
        }
    }
}
