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
 * Foreground service that runs the actual alarms: ongoing, non-dismissable,
 * full-screen notifications plus looping sound/vibration that stop ONLY when the
 * user taps "Done". Multiple occurrences can be active at once — each gets its
 * own notification (distinct id) so they all show simultaneously; the service
 * stays alive until the last one is cleared.
 *
 * "Done" is authoritative locally (stops the alarm immediately) and enqueues a
 * pending ack that the WebView delivers to the server (it holds the cookie).
 */
class AlarmService : Service() {

    private val active = LinkedHashMap<String, AlarmSpec>()
    // Occurrences whose notification is showing the "tap again to confirm" prompt.
    private val confirming = HashSet<String>()
    // First-post time per occurrence, pinned so re-posts don't reorder the shade.
    private val postedAt = HashMap<String, Long>()
    private val loops = HashMap<String, Runnable>()
    private var player: MediaPlayer? = null
    private var continuousAlarm = false
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    // The occurrence whose notification the foreground service is bound to.
    private var foregroundId: String? = null

    private val nm get() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notifId(occurrenceId: String): Int = occurrenceId.hashCode()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return START_STICKY
                startAlarm(
                    AlarmSpec(
                        occurrenceId = occurrenceId,
                        fireAtMs = 0,
                        title = intent.getStringExtra("title") ?: "Reminder",
                        body = intent.getStringExtra("body") ?: "",
                        soundIntervalSeconds = intent.getIntExtra("soundIntervalSeconds", 0),
                        alarm = intent.getBooleanExtra("alarm", false),
                        ongoing = intent.getBooleanExtra("ongoing", true),
                        soundUri = intent.getStringExtra("soundUri") ?: "",
                        reminderId = intent.getStringExtra("reminderId") ?: ""
                    )
                )
            }
            ACTION_STOP -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
                if (occurrenceId != null) clear(occurrenceId) else clearAll()
            }
            ACTION_PROMPT_CONFIRM -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return START_STICKY
                setConfirming(occurrenceId, true)
            }
            ACTION_CANCEL_CONFIRM -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return START_STICKY
                setConfirming(occurrenceId, false)
            }
            ACTION_RESHOW -> {
                // The user swiped a notification away (Android 14+ allows this for
                // foreground services). None are acknowledged, so re-post *all* the
                // active ones — when several are swiped together only one delete
                // intent may reach us, but every reminder must come back.
                if (active.isEmpty()) {
                    // Satisfy the FGS start contract, then stop cleanly.
                    startForeground(SENTINEL_ID, placeholderNotification())
                    clearAll()
                } else {
                    repostActive()
                }
            }
        }
        return START_STICKY
    }

    private fun startAlarm(spec: AlarmSpec) {
        ensureChannels()
        active[spec.occurrenceId] = spec
        // Stamp the post time once, on first fire, and keep it across every re-post
        // (re-notify loop / swipe-reshow / re-bind). The shade orders by `when`, so a
        // pinned, strictly-increasing timestamp keeps the newest reminder on top
        // instead of letting an older one float back up when it re-notifies.
        postedAt.getOrPut(spec.occurrenceId) { System.currentTimeMillis() }
        activeIds.add(spec.occurrenceId)
        if (spec.alarm) alarmIds.add(spec.occurrenceId) else alarmIds.remove(spec.occurrenceId)

        val notif = buildNotification(spec)
        if (foregroundId == null) {
            foregroundId = spec.occurrenceId
            startForeground(notifId(spec.occurrenceId), notif)
        } else {
            nm.notify(notifId(spec.occurrenceId), notif)
        }

        if (spec.alarm) {
            if (!continuousAlarm) startContinuousAlarm(spec.soundUri)
        } else {
            playNotificationSound(spec.soundUri)
            loops.remove(spec.occurrenceId)?.let { handler.removeCallbacks(it) }
            if (spec.soundIntervalSeconds > 0) startReNotifyLoop(spec)
        }
    }

    /**
     * Toggle the "tap again to confirm" prompt for one occurrence and re-post its
     * notification in place. Does not touch the sound/vibration, so the alarm keeps
     * nagging while the user is asked to confirm.
     */
    private fun setConfirming(occurrenceId: String, confirm: Boolean) {
        val spec = active[occurrenceId] ?: return
        if (confirm) confirming.add(occurrenceId) else confirming.remove(occurrenceId)
        val notif = buildNotification(spec)
        if (foregroundId == occurrenceId) startForeground(notifId(occurrenceId), notif)
        else nm.notify(notifId(occurrenceId), notif)
    }

    /** (Re)bind the foreground notification to a specific occurrence. */
    private fun bindForeground(spec: AlarmSpec) {
        foregroundId = spec.occurrenceId
        startForeground(notifId(spec.occurrenceId), buildNotification(spec))
    }

    /** Re-post every active notification (one bound to the foreground service). */
    private fun repostActive() {
        var bound = false
        for ((id, spec) in active) {
            val notif = buildNotification(spec)
            if (!bound) {
                foregroundId = id
                startForeground(notifId(id), notif)
                bound = true
            } else {
                nm.notify(notifId(id), notif)
            }
        }
    }

    private fun resolveUri(uriStr: String, defaultType: Int): android.net.Uri =
        if (uriStr.isNotEmpty()) android.net.Uri.parse(uriStr) else RingtoneManager.getDefaultUri(defaultType)

    private fun placeholderNotification(): android.app.Notification {
        ensureChannels()
        return NotificationCompat.Builder(this, CHANNEL_SILENT)
            .setContentTitle("Reminder")
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .build()
    }

    private fun buildNotification(spec: AlarmSpec): android.app.Notification {
        // The notification never carries audio — we play the chosen sound via
        // MediaPlayer — so it always uses the silent channel.
        val contentPending = PendingIntent.getBroadcast(
            this,
            ("open:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_OPEN)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
                .putExtra(AlarmReceiver.EXTRA_REMINDER_ID, spec.reminderId),
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
        // First "Done" tap -> ask for confirmation (doesn't ack); see AlarmReceiver.
        val donePending = PendingIntent.getBroadcast(
            this,
            ("done:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_DONE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // The deliberate confirm tap -> ack + stop (no app launch).
        val confirmPending = PendingIntent.getBroadcast(
            this,
            ("confirm:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_CONFIRM)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Back out of the confirm prompt -> restore the normal Done/Snooze actions.
        val cancelDonePending = PendingIntent.getBroadcast(
            this,
            ("canceldone:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_CANCEL_DONE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Snooze opens a small picker so the user chooses how long.
        val snoozePending = PendingIntent.getActivity(
            this,
            ("snooze:" + spec.occurrenceId).hashCode(),
            Intent(this, SnoozePickerActivity::class.java)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val reshowPending = PendingIntent.getBroadcast(
            this,
            ("reshow:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_RESHOW)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val awaitingConfirm = confirming.contains(spec.occurrenceId)
        // Pinned post time -> newest reminder sorts to the top of the shade and stays
        // there across re-posts (sortKey is inverted so the largest `when` sorts first).
        val posted = postedAt[spec.occurrenceId] ?: System.currentTimeMillis()
        val builder = NotificationCompat.Builder(this, CHANNEL_SILENT)
            .setContentTitle(spec.title)
            .setContentText(if (awaitingConfirm) "Tap \"Confirm done\" to mark complete" else spec.body)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setCategory(if (spec.alarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (spec.alarm) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setOngoing(spec.ongoing)
            .setAutoCancel(!spec.ongoing)
            .setWhen(posted)
            .setShowWhen(true)
            .setSortKey((Long.MAX_VALUE - posted).toString().padStart(20, '0'))
            .setContentIntent(contentPending)
        if (awaitingConfirm) {
            builder.addAction(0, "Confirm done", confirmPending)
            builder.addAction(0, "Not yet", cancelDonePending)
        } else {
            builder.addAction(0, "Done", donePending)
            builder.addAction(0, "Snooze", snoozePending)
        }
        if (spec.alarm) {
            builder.setFullScreenIntent(fullScreen, true)
        }
        if (spec.ongoing) {
            builder.setDeleteIntent(reshowPending)
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
            continuousAlarm = true
        } catch (_: Exception) {
            // ignore playback failures; the visual alarm still stands
        }
        val vib = object : Runnable {
            override fun run() {
                vibrate()
                handler.postDelayed(this, 3000L)
            }
        }
        loops[VIBRATE_KEY] = vib
        handler.post(vib)
    }

    /** Notification: play the chosen notification tone once (unless an alarm is ringing). */
    private fun playNotificationSound(soundUri: String) {
        if (continuousAlarm) return // don't interrupt a ringing alarm
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
                nm.notify(notifId(current.occurrenceId), buildNotification(current))
                playNotificationSound(current.soundUri)
                handler.postDelayed(this, intervalMs)
            }
        }
        loops[spec.occurrenceId] = runnable
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

    /** Stop the shared player + the vibration loop (not the per-occurrence re-notify loops). */
    private fun stopSound() {
        loops.remove(VIBRATE_KEY)?.let { handler.removeCallbacks(it) }
        player?.release()
        player = null
        continuousAlarm = false
    }

    private fun clear(occurrenceId: String) {
        active.remove(occurrenceId)
        confirming.remove(occurrenceId)
        postedAt.remove(occurrenceId)
        activeIds.remove(occurrenceId)
        alarmIds.remove(occurrenceId)
        loops.remove(occurrenceId)?.let { handler.removeCallbacks(it) }
        nm.cancel(notifId(occurrenceId))
        AlarmPlugin.cancelAlarm(this, occurrenceId)
        AlarmStore.remove(this, occurrenceId)
        // Also drop any pending escalation timer for this occurrence.
        val escId = occurrenceId + AlarmReceiver.ESC_SUFFIX
        AlarmPlugin.cancelAlarm(this, escId)
        AlarmStore.remove(this, escId)

        if (active.isEmpty()) {
            clearAll()
            return
        }
        // Re-bind the foreground notification if the cleared one was holding it.
        if (foregroundId == occurrenceId) {
            active.values.lastOrNull()?.let { bindForeground(it) }
        }
        // Keep a ringing alarm going if any alarm occurrence remains; otherwise
        // stop the continuous sound (per-occurrence notification loops continue).
        val nextAlarm = active.values.firstOrNull { it.alarm }
        if (nextAlarm != null) {
            if (!continuousAlarm) startContinuousAlarm(nextAlarm.soundUri)
        } else if (continuousAlarm) {
            stopSound()
        }
    }

    private fun clearAll() {
        stopSound()
        for (r in loops.values) handler.removeCallbacks(r)
        loops.clear()
        active.clear()
        confirming.clear()
        postedAt.clear()
        activeIds.clear()
        alarmIds.clear()
        foregroundId = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = nm
        if (manager.getNotificationChannel(CHANNEL_SILENT) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_SILENT, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Persistent reminders and alarms"
                    setSound(null, null) // we play our own sound via MediaPlayer
                    enableVibration(false)
                    setBypassDnd(true)
                }
            )
        }
    }

    override fun onDestroy() {
        stopSound()
        for (r in loops.values) handler.removeCallbacks(r)
        loops.clear()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "ca.persistent.app.SERVICE_START"
        const val ACTION_STOP = "ca.persistent.app.SERVICE_STOP"
        const val ACTION_RESHOW = "ca.persistent.app.SERVICE_RESHOW"
        const val ACTION_PROMPT_CONFIRM = "ca.persistent.app.SERVICE_PROMPT_CONFIRM"
        const val ACTION_CANCEL_CONFIRM = "ca.persistent.app.SERVICE_CANCEL_CONFIRM"
        const val DEFAULT_SNOOZE_MINUTES = 10
        private const val CHANNEL_SILENT = "reminders_silent"
        private const val SENTINEL_ID = 4201
        private const val VIBRATE_KEY = "__vibrate__"

        // What's currently showing (and which of those are ringing as an alarm), so
        // a resync can re-arm future alarms without re-firing ones already on screen.
        val activeIds: MutableSet<String> = java.util.Collections.synchronizedSet(LinkedHashSet())
        val alarmIds: MutableSet<String> = java.util.Collections.synchronizedSet(LinkedHashSet())
        fun isActive(occurrenceId: String): Boolean = activeIds.contains(occurrenceId)
        fun isAlarmActive(occurrenceId: String): Boolean = alarmIds.contains(occurrenceId)

        /** Bring the WebView app to the foreground (used by the notification tap). */
        fun launchAppPublic(context: Context) = launchApp(context)

        /**
         * Called by the confirm action: queue the ack and stop the alarm. Deliberately
         * does NOT launch the app — the WebView posts the queued ack when it next runs.
         */
        fun markDone(context: Context, occurrenceId: String) {
            PendingAckStore.add(context, occurrenceId)
            stopFor(context, occurrenceId)
        }

        /** First "Done" tap: switch the notification into its confirm state. */
        fun promptConfirm(context: Context, occurrenceId: String) {
            context.startService(
                Intent(context, AlarmService::class.java)
                    .setAction(ACTION_PROMPT_CONFIRM)
                    .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
            )
        }

        /** "Not yet": restore the notification's normal Done/Snooze actions. */
        fun cancelConfirm(context: Context, occurrenceId: String) {
            context.startService(
                Intent(context, AlarmService::class.java)
                    .setAction(ACTION_CANCEL_CONFIRM)
                    .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
            )
        }

        /**
         * Snooze for `minutes`: re-arm the local alarm and stop the current sound,
         * and queue the snooze for the server (drained by the WebView) so it's
         * authoritative and syncs across devices. The escalation backstop stays
         * server-anchored to the original fire.
         */
        fun snooze(context: Context, occurrenceId: String, minutes: Int) {
            val spec = AlarmStore.find(context, occurrenceId)
            PendingSnoozeStore.add(context, occurrenceId, minutes)
            stopFor(context, occurrenceId)
            if (spec != null) {
                val snoozed = spec.copy(fireAtMs = System.currentTimeMillis() + minutes * 60_000L)
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
