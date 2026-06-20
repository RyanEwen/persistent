package ca.persistent.app.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat

/**
 * Foreground service that runs the actual alarm: an ongoing, non-dismissable,
 * full-screen notification plus looping sound/vibration that stops ONLY when the
 * user taps "Done". Multiple occurrences can be active at once; we keep the
 * service alive until the last one is cleared.
 *
 * "Done" is authoritative locally (stops the alarm immediately) and enqueues a
 * pending ack that the WebView delivers to the server (it holds the cookie).
 */
class AlarmService : Service() {

    private val active = LinkedHashMap<String, AlarmSpec>()
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private var loopRunnable: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return START_STICKY
                val spec = AlarmSpec(
                    occurrenceId = occurrenceId,
                    fireAtMs = 0,
                    title = intent.getStringExtra("title") ?: "Reminder",
                    body = intent.getStringExtra("body") ?: "",
                    soundIntervalSeconds = intent.getIntExtra("soundIntervalSeconds", 0),
                    alarm = intent.getBooleanExtra("alarm", true)
                )
                startAlarm(spec)
            }
            ACTION_STOP -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
                if (occurrenceId != null) clear(occurrenceId) else clearAll()
            }
        }
        return START_STICKY
    }

    private fun startAlarm(spec: AlarmSpec) {
        ensureChannel()
        active[spec.occurrenceId] = spec
        // Foreground with the most recent alarm's notification.
        startForeground(NOTIFICATION_ID, buildNotification(spec))
        if (spec.alarm) startSoundLoop(spec.soundIntervalSeconds)
    }

    private fun buildNotification(spec: AlarmSpec): android.app.Notification {
        val fullScreen = PendingIntent.getActivity(
            this,
            spec.occurrenceId.hashCode(),
            Intent(this, AlarmActivity::class.java)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
                .putExtra("title", spec.title)
                .putExtra("body", spec.body)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val donePending = PendingIntent.getBroadcast(
            this,
            ("done:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_DONE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val snoozePending = PendingIntent.getBroadcast(
            this,
            ("snooze:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_SNOOZE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(spec.title)
            .setContentText(spec.body)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)        // can't be swiped away
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreen, true) // wakes the screen with the alarm UI
            .addAction(0, "Done", donePending)
            .addAction(0, "Snooze 10m", snoozePending)
            .build()
    }

    private fun startSoundLoop(intervalSeconds: Int) {
        stopSoundLoop()
        playOnce()
        if (intervalSeconds > 0) {
            val runnable = object : Runnable {
                override fun run() {
                    playOnce()
                    handler.postDelayed(this, intervalSeconds * 1000L)
                }
            }
            loopRunnable = runnable
            handler.postDelayed(runnable, intervalSeconds * 1000L)
        }
    }

    private fun playOnce() {
        try {
            player?.release()
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@AlarmService, uri)
                isLooping = false
                prepare()
                start()
            }
        } catch (_: Exception) {
            // ignore playback failures; the visual alarm still stands
        }
        vibrate()
    }

    private fun vibrate() {
        val v = vibrator ?: (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).also { vibrator = it }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600), -1))
        } else {
            @Suppress("DEPRECATION") v.vibrate(longArrayOf(0, 600, 400, 600), -1)
        }
    }

    private fun stopSoundLoop() {
        loopRunnable?.let { handler.removeCallbacks(it) }
        loopRunnable = null
        player?.release()
        player = null
    }

    private fun clear(occurrenceId: String) {
        active.remove(occurrenceId)
        AlarmPlugin.cancelAlarm(this, occurrenceId)
        AlarmStore.remove(this, occurrenceId)
        if (active.isEmpty()) {
            clearAll()
        } else {
            // Show the next still-active alarm and keep sounding.
            val next = active.values.last()
            startForeground(NOTIFICATION_ID, buildNotification(next))
        }
    }

    private fun clearAll() {
        stopSoundLoop()
        active.clear()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Persistent reminder alarms"
            // We play our own looping alarm sound; silence the channel to avoid double audio.
            setSound(null, null)
            enableVibration(false)
            setBypassDnd(true)
        }
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        stopSoundLoop()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "ca.persistent.app.SERVICE_START"
        const val ACTION_STOP = "ca.persistent.app.SERVICE_STOP"
        private const val CHANNEL_ID = "reminders"
        private const val NOTIFICATION_ID = 4201

        /** Called by the Done action: queue the ack and stop the alarm + launch app. */
        fun markDone(context: Context, occurrenceId: String) {
            PendingAckStore.add(context, occurrenceId)
            stopFor(context, occurrenceId)
            launchApp(context)
        }

        /** Snooze 10 minutes: re-arm the local alarm and stop the current sound. */
        fun snooze(context: Context, occurrenceId: String) {
            val spec = AlarmStore.find(context, occurrenceId)
            stopFor(context, occurrenceId)
            if (spec != null) {
                val snoozed = spec.copy(fireAtMs = System.currentTimeMillis() + 10 * 60_000L)
                AlarmStore.put(context, snoozed)
                AlarmPlugin.armAlarm(context, snoozed)
            }
        }

        fun stopFor(context: Context, occurrenceId: String) {
            context.startService(
                Intent(context, AlarmService::class.java)
                    .setAction(ACTION_STOP)
                    .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
            )
        }

        fun stopAll(context: Context) {
            context.startService(Intent(context, AlarmService::class.java).setAction(ACTION_STOP))
        }

        private fun launchApp(context: Context) {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (launch != null) context.startActivity(launch)
        }
    }
}
