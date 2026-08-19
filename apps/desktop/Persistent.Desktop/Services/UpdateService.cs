using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using WinRT.Interop;
using global::Windows.ApplicationModel;
using global::Windows.Services.Store;
using static Persistent.Desktop.Classes.NativeMethods;

namespace Persistent.Desktop.Services;

/// <summary>
/// Manual update check, run only when the user clicks the button on the About
/// page — there is no automatic or background network activity on either path.
///
/// Which path depends on how the app was installed, because the two are updated
/// by completely different machinery:
///
/// - **Unpackaged** (the portable build): this repo's GitHub Releases. The result
///   is a link to the release page; the user downloads and unzips it themselves.
/// - **Packaged** (Store or sideloaded MSIX): the Microsoft Store, which installs
///   in place. Checking GitHub here would compare against a channel that cannot
///   install anything, and offering a download beside a Store install is the kind
///   of alternative update mechanism Store policy exists to stop.
///
/// Desktop releases are tagged `desktop-vX.Y.Z` so they don't collide with the
/// Android `vX.Y.Z` tags in the same repository, which is why the GitHub path
/// reads the release list rather than `releases/latest` (that endpoint returns the
/// newest release of *any* kind, which for this repo is usually an Android build).
///
/// The Store half is ported from the sibling TechnicallyReal apps rather than
/// written fresh; the comments below carry the traps they hit in production, and
/// each one is load-bearing.
/// </summary>
public static class UpdateService
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private const string Owner = "RyanEwen";
    private const string Repo = "persistent";
    public const string TagPrefix = "desktop-v";

    /// <summary>Partner Center product ID. Public information, so not a secret.</summary>
    private const string StoreProductId = "9PCX2XGQ7CJS";

    /// <summary>Must match the manifest's &lt;Application Id="App"&gt;.</summary>
    private const string PackagedApplicationId = "App";

    private static readonly Uri ReleasesUri = new($"https://api.github.com/repos/{Owner}/{Repo}/releases?per_page=30");

    private static readonly HttpClient Http = CreateHttpClient();

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"Persistent.Desktop/{CurrentVersion()}");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public enum UpdateSource
    {
        GitHubRelease,
        MicrosoftStore,
    }

    public sealed class UpdateCheckResult
    {
        public UpdateSource Source { get; init; }
        public bool UpdateAvailable { get; init; }
        public string CurrentVersion { get; init; } = "";
        public string LatestVersion { get; init; } = "";
        public string? ReleaseUrl { get; init; }
        /// <summary>Set when the check could not complete (offline, rate-limited).</summary>
        public string? Error { get; init; }

        /// <summary>True when the Store owns installing this update, not the user.</summary>
        public bool IsStoreManaged => Source == UpdateSource.MicrosoftStore;
    }

    private sealed class GithubRelease
    {
        [JsonPropertyName("tag_name")] public string? TagName { get; set; }
        [JsonPropertyName("html_url")] public string? HtmlUrl { get; set; }
        [JsonPropertyName("draft")] public bool Draft { get; set; }
        [JsonPropertyName("prerelease")] public bool Prerelease { get; set; }
    }

    /// <summary>
    /// True when running from an MSIX package, so Windows owns updating.
    ///
    /// <c>Package.Current</c> throws rather than returning null when the process is
    /// unpackaged, which is the documented way to tell the two apart. Cached
    /// because the answer cannot change while the process lives.
    ///
    /// Note this asks "packaged?", not "installed from the Store?" — a sideloaded
    /// MSIX answers true as well. That is deliberate: a sideloaded package is also
    /// updated by installing a package, so pointing it at a portable-build release
    /// page would be wrong too.
    /// </summary>
    public static bool IsPackaged { get; } = DetectPackaged();

    private static bool DetectPackaged()
    {
        try
        {
            _ = Package.Current.Id;
            return true;
        }
        catch (Exception ex)
        {
            Logger.Debug(ex, "No package identity; running unpackaged");
            return false;
        }
    }

    public static string CurrentVersion()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version;
        return version == null ? "0.0.0" : $"{version.Major}.{version.Minor}.{version.Build}";
    }

    public static Task<UpdateCheckResult> CheckAsync(CancellationToken ct = default) =>
        IsPackaged ? CheckStoreAsync() : CheckGitHubAsync(ct);

    // ── GitHub (portable build) ──────────────────────────────────────────

    private static async Task<UpdateCheckResult> CheckGitHubAsync(CancellationToken ct)
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

    // ── Microsoft Store (packaged build) ─────────────────────────────────

    private static async Task<UpdateCheckResult> CheckStoreAsync()
    {
        string current = FormatPackageVersion(Package.Current.Id.Version);
        try
        {
            var context = StoreContext.GetDefault();
            var updates = await context.GetAppAndOptionalStorePackageUpdatesAsync();

            var currentPackageVersion = PackageVersionToVersion(Package.Current.Id.Version);
            string currentPackageName = Package.Current.Id.FamilyName;

            // GetAppAndOptionalStorePackageUpdatesAsync lists every package the Store
            // can update — including framework dependencies like the Windows App
            // Runtime — so the app's own package has to be picked out by family name.
            // Its presence in that list *is* the "an update is waiting for you" signal.
            //
            // What it is NOT is a source of the new version number: StorePackageUpdate
            // .Package describes the package as installed, so Id.Version reports the
            // version already on the machine. Requiring the listed version to be
            // strictly newer therefore never matches, and the Store path reports "up
            // to date" forever while the Store shows an update ready. The sibling apps
            // shipped that bug and verified the cause against a live Store update.
            // Do not reintroduce that comparison.
            bool ourPackageListed = updates.Any(update => update.Package != null && string.Equals(
                update.Package.Id.FamilyName, currentPackageName, StringComparison.OrdinalIgnoreCase));

            // The version to show comes from the Store catalog instead — the only
            // place that knows what is actually published. Best-effort: a null answer
            // means "cannot say", and the Store's own list is then trusted on its own
            // rather than being vetoed by a failed lookup.
            Version? publishedVersion = ourPackageListed ? await TryGetPublishedVersionAsync() : null;
            bool publishedIsNewer = publishedVersion != null && publishedVersion > currentPackageVersion;
            bool updateAvailable = ourPackageListed && (publishedVersion == null || publishedIsNewer);

            // Logged on every check because the failure this replaced was invisible:
            // the check succeeded, so nothing was written, and "up to date" was
            // indistinguishable from a bug.
            Logger.Info(
                "Store update check: {Count} package update(s) listed, ours present: {Ours}, "
                + "installed {Current}, published {Published}, update available: {Available}",
                updates.Count, ourPackageListed, currentPackageVersion,
                publishedVersion?.ToString() ?? "unknown", updateAvailable);

            return new UpdateCheckResult
            {
                Source = UpdateSource.MicrosoftStore,
                UpdateAvailable = updateAvailable,
                CurrentVersion = current,

                // Empty means "there is a newer version but its number is not known";
                // the UI words that case without a version rather than inventing one.
                LatestVersion = updateAvailable && publishedIsNewer
                    ? $"{publishedVersion!.Major}.{publishedVersion.Minor}.{publishedVersion.Build}"
                    : updateAvailable ? "" : current,
            };
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Store update check failed");
            return new UpdateCheckResult
            {
                Source = UpdateSource.MicrosoftStore,
                CurrentVersion = current,
                LatestVersion = current,
                Error = ex.Message,
            };
        }
    }

    // The packaged build reads its version from the package rather than the
    // assembly, so the number shown matches what the Store thinks is installed.
    // Both drop the fourth part, which MSIX requires to be 0 and nobody wants to read.
    private static string FormatPackageVersion(PackageVersion version) =>
        $"{version.Major}.{version.Minor}.{version.Build}";

    private static Version PackageVersionToVersion(PackageVersion version) =>
        new(version.Major, version.Minor, version.Build, version.Revision);

    /// <summary>
    /// Reads the version currently published to the Store for this product, or null
    /// if it cannot be determined. Uses the Store's public display-catalog endpoint,
    /// which is what the Store client itself reads; there is no WinRT API that
    /// reports a pending update's version.
    /// </summary>
    private static async Task<Version?> TryGetPublishedVersionAsync()
    {
        try
        {
            var uri = new Uri(
                $"https://displaycatalog.mp.microsoft.com/v7.0/products/{StoreProductId}"
                + "?market=US&languages=en-us&fieldsTemplate=Details");

            using var stream = await Http.GetStreamAsync(uri);
            using var doc = await JsonDocument.ParseAsync(stream);

            string arch = Package.Current.Id.Architecture switch
            {
                global::Windows.System.ProcessorArchitecture.Arm64 => "arm64",
                global::Windows.System.ProcessorArchitecture.X86 => "x86",
                _ => "x64",
            };

            Version? best = null;

            if (!doc.RootElement.TryGetProperty("Product", out var product)
                || !product.TryGetProperty("DisplaySkuAvailabilities", out var skus))
            {
                return null;
            }

            foreach (var sku in skus.EnumerateArray())
            {
                if (!sku.TryGetProperty("Sku", out var skuInfo)
                    || !skuInfo.TryGetProperty("Properties", out var props)
                    || !props.TryGetProperty("Packages", out var packages))
                {
                    continue;
                }

                foreach (var package in packages.EnumerateArray())
                {
                    // The catalog's numeric "Version" is a packed 64-bit value; the
                    // version in human form only appears inside the package full name
                    // (Name_0.2.4.0_arm64__hash), which is also where the architecture is.
                    if (package.TryGetProperty("PackageFullName", out var fullNameElement)
                        && fullNameElement.GetString() is { } fullName)
                    {
                        var parts = fullName.Split('_');
                        if (parts.Length < 3) continue;
                        if (!parts[2].Equals(arch, StringComparison.OrdinalIgnoreCase)) continue;
                        if (!Version.TryParse(parts[1], out var parsed)) continue;
                        if (best == null || parsed > best) best = parsed;
                    }
                }
            }

            return best;
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Failed to read the published Store version");
            return null;
        }
    }

    /// <summary>
    /// Downloads and installs the pending Store update. The caller exits the app
    /// afterwards on success; this schedules the return trip.
    /// </summary>
    /// <returns>
    /// <c>RestartMayHelp</c> distinguishes the one failure that is not really a
    /// failure — nothing left to download because Windows already staged the update
    /// and is waiting on our exit — from the genuine ones. The caller offers a
    /// restart for it and nothing for the rest; sniffing the message text to tell
    /// them apart would break the moment the wording changed.
    /// </returns>
    public static async Task<(bool Success, string Message, bool RestartMayHelp)> DownloadAndInstallStoreUpdateAsync(
        nint ownerWindowHandle,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();

            var context = StoreContext.GetDefault();
            // StoreContext raises its own dialogs and needs an owner, or they have
            // nowhere to appear in a desktop app.
            if (ownerWindowHandle != 0)
                InitializeWithWindow.Initialize(context, ownerWindowHandle);

            var updates = await context.GetAppAndOptionalStorePackageUpdatesAsync();
            if (updates.Count == 0)
            {
                // Nothing to download can mean genuinely up to date, or that Windows
                // already staged the update in the background and is waiting for this
                // app to exit. The API stops listing a package once it is staged, so
                // the two are indistinguishable from here. Offering the restart is the
                // useful move either way: it costs a relaunch if wrong, and completes a
                // stuck update if right.
                return (false,
                    "No download is pending. If an update was already downloaded in the "
                    + "background, restart Persistent to finish installing it.",
                    true);
            }

            // ── Download first, install second ───────────────────────────
            // These two have opposite requirements and must not be a single call.
            // RequestDownloadStorePackageUpdatesAsync runs while the app is in use and
            // does not block, which is the only place real progress can come from.
            // Installing needs every process in the package to exit. Calling the
            // combined API from a tray app that never closes hides the download behind
            // a wait that cannot resolve, and shows nothing at all meanwhile.
            var download = context.RequestDownloadStorePackageUpdatesAsync(updates);
            download.Progress = (_, status) =>
                progress?.Report(Math.Clamp(status.PackageDownloadProgress, 0.0, 1.0));

            var downloadResult = await download;
            if (downloadResult.OverallState is not (StorePackageUpdateState.Completed
                or StorePackageUpdateState.Deploying))
            {
                return (false, DescribeStoreUpdateState(downloadResult.OverallState, downloadResult), false);
            }

            progress?.Report(1.0);

            // The install cannot finish while we are running, so ask Windows to bring
            // us back afterwards and then get out of the way. RegisterApplicationRestart
            // has to be in place before shutdown begins.
            RegisterApplicationRestart(null, 0);

            var operation = context.RequestDownloadAndInstallStorePackageUpdatesAsync(updates);
            operation.Progress = (_, status) =>
            {
                double normalized = status.PackageDownloadProgress >= 0.8
                    ? 1.0
                    : Math.Clamp(status.PackageDownloadProgress / 0.8, 0.0, 0.99);
                progress?.Report(normalized);
            };

            var result = await operation;
            progress?.Report(1.0);

            return result.OverallState switch
            {
                StorePackageUpdateState.Completed => (true, SchedulePackagedRelaunchAfterExit(), false),

                // Bytes are down and the install is queued behind our exit. That is
                // success from here: reporting it as a failure would leave the user
                // pressing a button that has already done its job.
                StorePackageUpdateState.Deploying => (true, SchedulePackagedRelaunchAfterExit(), false),
                StorePackageUpdateState.Canceled => (false, "Update was cancelled in the Microsoft Store dialog.", false),
                StorePackageUpdateState.ErrorLowBattery => (false, "Update paused because the device battery is too low.", false),
                StorePackageUpdateState.ErrorWiFiRecommended => (false, "Update was paused because a non-metered connection is recommended.", false),
                StorePackageUpdateState.ErrorWiFiRequired => (false, "Update requires Wi-Fi before the Microsoft Store can continue.", false),
                StorePackageUpdateState.OtherError => (false, BuildStoreUpdateErrorMessage(result), false),
                _ => (false, "The Microsoft Store could not install the update.", false),
            };
        }
        catch (OperationCanceledException)
        {
            // Not logged: a cancellation is the user's decision, not a failure, and
            // it is reported back to them rather than swallowed.
            return (false, "Update was cancelled.", false);
        }
        catch (Exception ex)
        {
            Logger.Error(ex, "Failed to install update from the Microsoft Store");
            return (false, $"Microsoft Store update failed: {ex.Message}", false);
        }
    }

    /// <summary>
    /// One place mapping a Store update state to something worth showing the user,
    /// so the download and install halves cannot describe the same condition
    /// differently.
    /// </summary>
    private static string DescribeStoreUpdateState(
        StorePackageUpdateState state, StorePackageUpdateResult result) => state switch
    {
        StorePackageUpdateState.Canceled => "Update was cancelled in the Microsoft Store dialog.",
        StorePackageUpdateState.ErrorLowBattery => "Update paused because the device battery is too low.",
        StorePackageUpdateState.ErrorWiFiRecommended => "Update was paused because a non-metered connection is recommended.",
        StorePackageUpdateState.ErrorWiFiRequired => "Update requires Wi-Fi before the Microsoft Store can continue.",
        StorePackageUpdateState.OtherError => BuildStoreUpdateErrorMessage(result),
        _ => "The Microsoft Store could not download the update.",
    };

    private static string BuildStoreUpdateErrorMessage(StorePackageUpdateResult result)
    {
        foreach (var status in result.StorePackageUpdateStatuses)
        {
            if (status.PackageUpdateState == StorePackageUpdateState.Completed)
                continue;

            return status.PackageUpdateState switch
            {
                StorePackageUpdateState.ErrorLowBattery => "Update paused because the device battery is too low.",
                StorePackageUpdateState.ErrorWiFiRecommended => "Update was paused because a non-metered connection is recommended.",
                StorePackageUpdateState.ErrorWiFiRequired => "Update requires Wi-Fi before the Microsoft Store can continue.",
                StorePackageUpdateState.Canceled => "Update was cancelled in the Microsoft Store dialog.",
                _ => "The Microsoft Store could not install the update. Try again later.",
            };
        }

        return "The Microsoft Store could not install the update. Try again later.";
    }

    /// <summary>
    /// Arranges for the app to come back after it exits, so Windows can apply an
    /// update that is already staged. The caller exits; this only sets the return
    /// trip up.
    /// </summary>
    /// <remarks>
    /// An MSIX package cannot be installed while any of its processes are running,
    /// and this app starts with Windows and lives in the tray — so a staged update
    /// can sit unapplied indefinitely while the Store reports it as up to date.
    /// Restarting applies anything staged without needing to detect it, which
    /// matters because there is no reliable way to ask:
    /// <c>Package.CheckUpdateAvailabilityAsync</c> only covers .appinstaller
    /// installs, not Store-distributed packages.
    /// </remarks>
    public static void RestartToApplyPackagedUpdate()
    {
        RegisterApplicationRestart(null, 0);
        SchedulePackagedRelaunchAfterExit();
    }

    private static string SchedulePackagedRelaunchAfterExit()
    {
        try
        {
            string aumid = $"{Package.Current.Id.FamilyName}!{PackagedApplicationId}";
            string tempDir = Path.Combine(Path.GetTempPath(), "Persistent-Update");
            Directory.CreateDirectory(tempDir);

            // A detached script rather than an in-process timer: the whole point is to
            // act after this process is gone, so the thing doing the waiting cannot be
            // inside it. It polls for our PID to disappear, gives the deployment a
            // moment, then launches by AUMID (the only way to start a packaged app
            // whose install path changes with every update).
            int pid = Environment.ProcessId;
            string scriptPath = Path.Combine(tempDir, "restart-store-update.cmd");
            string script = $"""
                @echo off
                :wait
                tasklist /FI "PID eq {pid}" 2>NUL | find /I "{pid}" >NUL
                if not errorlevel 1 (
                    timeout /t 1 /nobreak >NUL
                    goto wait
                )
                timeout /t 2 /nobreak >NUL
                start "" explorer.exe "shell:AppsFolder\{aumid}"
                """;
            File.WriteAllText(scriptPath, script);

            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{scriptPath}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });

            return "Persistent will relaunch after the Microsoft Store finishes applying the update.";
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Failed to schedule relaunch after Microsoft Store update");
            return "Update installed. Restart Persistent manually if it does not relaunch automatically.";
        }
    }
}
