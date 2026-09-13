using System.Collections.Concurrent;

namespace Persistent.Desktop.Notifications;

/// <summary>
/// Keeps active Windows notifications present while the tray process is running.
/// Missing toasts are restored after dismissal, configured soft nags re-alert on
/// their interval, and a periodic server refresh catches events missed across sleep
/// or a connection race.
/// </summary>
internal sealed class NotificationPersistenceMonitor : IDisposable
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    private static readonly TimeSpan PresenceInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ServerRefreshInterval = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<string, TrackedNotification> _live;
    private readonly ToastNotifier _toasts;
    private readonly Action<NotificationOccurrence> _show;
    private readonly Action _requestRefresh;

    private CancellationTokenSource? _cts;
    private Task? _loop;

    public NotificationPersistenceMonitor(
        ConcurrentDictionary<string, TrackedNotification> live,
        ToastNotifier toasts,
        Action<NotificationOccurrence> show,
        Action requestRefresh)
    {
        _live = live;
        _toasts = toasts;
        _show = show;
        _requestRefresh = requestRefresh;
    }

    public void Start()
    {
        if (_loop is { IsCompleted: false }) return;

        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cts.Token));
        Logger.Info("Notification persistence monitor started");
    }

    public void Stop()
    {
        try
        {
            _cts?.Cancel();
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Stopping the notification persistence monitor failed");
        }

        _cts = null;
        _loop = null;
    }

    private async Task RunAsync(CancellationToken token)
    {
        DateTimeOffset nextServerRefresh = DateTimeOffset.UtcNow;

        while (!token.IsCancellationRequested)
        {
            try
            {
                DateTimeOffset now = DateTimeOffset.UtcNow;
                if (now >= nextServerRefresh)
                {
                    _requestRefresh();
                    nextServerRefresh = now + ServerRefreshInterval;
                }

                var shown = await _toasts.GetShownOccurrenceIdsAsync();
                if (shown != null)
                {
                    foreach (var tracked in _live.Values)
                    {
                        bool wasDismissed = !shown.Contains(tracked.Occurrence.OccurrenceId);
                        bool intervalElapsed = ShouldRepeatSound(tracked, now);
                        if (wasDismissed || intervalElapsed)
                        {
                            _show(tracked.Occurrence);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.Warn(ex, "Notification persistence check failed");
            }

            try
            {
                await Task.Delay(PresenceInterval, token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    /// <summary>
    /// Alarm audio already loops continuously. Only a soft notification with an
    /// explicit nag interval should re-alert while it remains present.
    /// </summary>
    private static bool ShouldRepeatSound(TrackedNotification tracked, DateTimeOffset now)
    {
        int seconds = tracked.Occurrence.SoundIntervalSeconds;
        return !tracked.ConfirmingDone
            && !tracked.Occurrence.Alarm
            && seconds > 0
            && now - tracked.LastShownAt >= TimeSpan.FromSeconds(seconds);
    }

    public void Dispose() => Stop();
}
