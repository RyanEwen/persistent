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
                    alarm = intent.getBooleanExtra("alarm", false),
                    ongoing = intent.getBooleanExtra("ongoing", true),
                    soundUri = intent.getStringExtra("soundUri") ?: ""
                )
                startAlarm(spec)
            }
            ACTION_STOP -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
                if (occurrenceId != null) clear(occurrenceId) else clearAll()
            }
            ACTION_RESHOW -> {
                // The user swiped the notification away (Android 14+ allows this for
                // foreground services). The alarm isn't acknowledged, so re-post it
                // — the sound loop kept running underneath.
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
                val spec = occurrenceId?.let { active[it] } ?: active.values.lastOrNull()
                if (spec != null) {
                    startForeground(NOTIFICATION_ID, buildNotification(spec))
                } else {
                    // Nothing active — satisfy the FGS start contract, then stop cleanly.
                    startForeground(NOTIFICATION_ID, buildNotification(AlarmSpec(occurrenceId ?: "", 0, "Reminder", "", 0, alarm = false, ongoing = false, soundUri = "")))
                    clearAll()
                }
            }
        }
        return START_STICKY
    }

    private fun startAlarm(spec: AlarmSpec) {
        ensureChannels()
        active[spec.occurrenceId] = spec
        // We always play the chosen sound ourselves (so each reminder can use its
        // own sound), so the notification channel is silent.
        startForeground(NOTIFICATION_ID, buildNotification(spec))
        if (spec.alarm) {
            startContinuousAlarm(spec.soundUri)
        } else {
            playNotificationSound(spec.soundUri)
            if (spec.soundIntervalSeconds > 0) startReNotifyLoop(spec)
        }
    }

    private fun resolveUri(uriStr: String, defaultType: Int): android.net.Uri =
        if (uriStr.isNotEmpty()) android.net.Uri.parse(uriStr) else RingtoneManager.getDefaultUri(defaultType)

    private fun buildNotification(spec: AlarmSpec): android.app.Notification {
        // The notification never carries audio — we play the chosen sound via
        // MediaPlayer — so it always uses the silent channel.
        val channelId = CHANNEL_SILENT
        val openApp = packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val contentPending = PendingIntent.getActivity(
            this,
            ("open:" + spec.occurrenceId).hashCode(),
            openApp ?: Intent(this, AlarmActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
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
        // If the user swipes the notification away, bring it back — the alarm is
        // only cleared by Done/Snooze, not by dismissal.
        val reshowPending = PendingIntent.getBroadcast(
            this,
            ("reshow:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_RESHOW)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, channelId)
            .setContentTitle(spec.title)
            .setContentText(spec.body)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setCategory(if (spec.alarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (spec.alarm) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setOngoing(spec.ongoing)        // persistent ones can't be casually swiped
            .setAutoCancel(!spec.ongoing)
            // No onlyAlertOnce: re-notify (sounding channel) must re-alert; silent
            // re-shows stay quiet because they use the silent channel.
            .setContentIntent(contentPending)
            .addAction(0, "Done", donePending)
            .addAction(0, "Snooze 10m", snoozePending)
        if (spec.alarm) {
            builder.setFullScreenIntent(fullScreen, true) // wakes the screen with the alarm UI
        }
        if (spec.ongoing) {
            builder.setDeleteIntent(reshowPending) // swipe-away re-posts persistent ones
        }
        return builder.build()
    }

    /** Alarm: ring the chosen alarm tone continuously (looping) + vibrate until cleared. */
    private fun startContinuousAlarm(soundUri: String) {
        stopSound()
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@AlarmService, resolveUri(soundUri, RingtoneManager.TYPE_ALARM))
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {
            // ignore playback failures; the visual alarm still stands
        }
        val vib = object : Runnable {
            override fun run() {
                vibrate()
                handler.postDelayed(this, 3000L)
            }
        }
        loopRunnable = vib
        handler.post(vib)
    }

    /** Notification: play the chosen notification tone once. */
    private fun playNotificationSound(soundUri: String) {
        try {
            player?.release()
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@AlarmService, resolveUri(soundUri, RingtoneManager.TYPE_NOTIFICATION))
                isLooping = false
                prepare()
                start()
            }
        } catch (_: Exception) {
            // ignore playback failures; the visual notification still stands
        }
        vibrate()
    }

    /** Notification: re-post + re-sound every N seconds so it keeps nagging. */
    private fun startReNotifyLoop(spec: AlarmSpec) {
        val intervalMs = spec.soundIntervalSeconds * 1000L
        val runnable = object : Runnable {
            override fun run() {
                val current = active[spec.occurrenceId] ?: return
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(NOTIFICATION_ID, buildNotification(current))
                playNotificationSound(current.soundUri)
                handler.postDelayed(this, intervalMs)
            }
        }
        loopRunnable = runnable
        handler.postDelayed(runnable, intervalMs)
    }

    private fun vibrate() {
        val v = vibrator ?: (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).also { vibrator = it }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600), -1))
        } else {
            @Suppress("DEPRECATION") v.vibrate(longArrayOf(0, 600, 400, 600), -1)
        }
    }

    private fun stopSound() {
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
            // Show the next still-active alarm (silent — it's a continuation).
            val next = active.values.last()
            startForeground(NOTIFICATION_ID, buildNotification(next))
        }
    }

    private fun clearAll() {
        stopSound()
        active.clear()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Sounding channel for ordinary notifications (one default sound on post).
        if (manager.getNotificationChannel(CHANNEL_NOTIF) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_NOTIF, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Reminder notifications"
                    setBypassDnd(true)
                }
            )
        }
        // Silent channel for alarms (we loop our own alarm sound) and for re-shows.
        if (manager.getNotificationChannel(CHANNEL_SILENT) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_SILENT, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Persistent reminder alarms"
                    setSound(null, null)
                    enableVibration(false)
                    setBypassDnd(true)
                }
            )
        }
    }

    override fun onDestroy() {
        stopSound()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "ca.persistent.app.SERVICE_START"
        const val ACTION_STOP = "ca.persistent.app.SERVICE_STOP"
        const val ACTION_RESHOW = "ca.persistent.app.SERVICE_RESHOW"
        private const val CHANNEL_NOTIF = "reminders"
        private const val CHANNEL_SILENT = "reminders_silent"
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
