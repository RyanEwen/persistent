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
import androidx.core.app.NotificationManagerCompat
import ca.persistent.app.R

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

    /** Whether posted notifications are actually visible to the user. When false
     *  (POST_NOTIFICATIONS denied), the alarm's shade surface never appears, so the
     *  full-screen activity becomes the only way to identify and stop it. */
    private fun notificationsVisible(): Boolean = NotificationManagerCompat.from(this).areNotificationsEnabled()

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
                        reminderId = intent.getStringExtra("reminderId") ?: "",
                        canSilence = intent.getBooleanExtra("canSilence", false),
                        shadeProminence = intent.getStringExtra("shadeProminence") ?: "INHERIT"
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
            ACTION_SILENCE -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return START_STICKY
                silenceOccurrence(occurrenceId)
            }
            ACTION_SNOOZE_LOCAL -> {
                val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return START_STICKY
                snoozeLocal(occurrenceId, intent.getIntExtra(EXTRA_SNOOZE_MINUTES, DEFAULT_SNOOZE_MINUTES))
            }
            ACTION_RESTYLE -> {
                // The device-default prominence changed (already persisted by the
                // caller). Re-post live notifications so the new channel applies now.
                if (active.isEmpty()) {
                    startForeground(SENTINEL_ID, placeholderNotification())
                    clearAll()
                } else {
                    restyleActive()
                }
            }
            ACTION_REFRESH -> {
                // A resync may have edited a live reminder (rename, body, or
                // per-reminder shade prominence); re-post any active notification
                // whose text or channel changed.
                if (active.isEmpty()) {
                    startForeground(SENTINEL_ID, placeholderNotification())
                    clearAll()
                } else {
                    refreshActive()
                }
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
            ACTION_ENSURE -> ensureNags()
        }
        return START_STICKY
    }

    /**
     * Re-post any overdue soft nag whose notification isn't currently showing —
     * SILENTLY (no sound), so a nag that vanished because the process/foreground
     * service was killed comes back and stays until Done, without re-alerting on
     * every check. Alarms/escalations are excluded (they must ring, not appear
     * quietly) — the fire path handles those. Reads the persisted [AlarmStore] so it
     * works offline and after a cold restart. Idempotent: already-showing nags are
     * left untouched, so it never re-sounds or reorders them.
     */
    private fun ensureNags() {
        ensureChannels()
        val now = System.currentTimeMillis()
        val due = AlarmStore.all(this).filter {
            !it.alarm && it.fireAtMs <= now && !it.occurrenceId.endsWith(AlarmReceiver.ESC_SUFFIX)
        }
        for (spec in due) {
            if (active.containsKey(spec.occurrenceId)) continue
            startAlarm(spec, silent = true)
        }
        // Guarantee the foreground-start contract (we're started via
        // startForegroundService): rebind to a live notification, or — if there is
        // nothing to show at all — post the placeholder and stop cleanly.
        val fg = foregroundId?.let { active[it] }
        if (fg != null) {
            startForeground(notifId(fg.occurrenceId), buildNotification(fg))
            updateGroupSummary()
        } else {
            startForeground(SENTINEL_ID, placeholderNotification())
            clearAll()
        }
    }

    private fun startAlarm(spec: AlarmSpec, silent: Boolean = false) {
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

        // A silent re-assert (ensureNags) only maintains the visible surface — it must
        // never ring, sound, or pop the full-screen alarm; the fire already happened.
        // De-dup the SOUND too: now that FCM delivers, an occurrence can be triggered
        // by both its on-device alarm and a redundant server fire/escalate push (which
        // falls back to the default tone) within a minute or two — don't re-play the
        // same occurrence's sound inside SOUND_DEBOUNCE_MS. The notification above still
        // (re)posts, and the intentional re-notify loop calls playNotificationSound
        // directly, so neither is affected.
        val now = System.currentTimeMillis()
        val debounced = now - AlarmStore.lastSoundedAt(this, spec.occurrenceId) < SOUND_DEBOUNCE_MS
        android.util.Log.i(
            "PersistAlarm",
            "startAlarm occ=${spec.occurrenceId} silent=$silent debounced=$debounced alarm=${spec.alarm} soundEmpty=${spec.soundUri.isEmpty()}"
        )
        if (silent || debounced) {
            updateGroupSummary()
            return
        }
        AlarmStore.markSoundedNow(this, spec.occurrenceId, now)
        if (spec.alarm) {
            if (!continuousAlarm) startContinuousAlarm(spec.soundUri)
            // If the shade notification can't be shown (POST_NOTIFICATIONS denied),
            // the full-screen surface is the ONLY thing that identifies the ringing
            // alarm and lets the user stop it — so force it up regardless of lock /
            // interactive state (AlarmActivity shows over the lock screen). Never let
            // sound play with no visible, stoppable surface.
            presentAlarmSurface(spec, force = !notificationsVisible())
        } else {
            playNotificationSound(spec.soundUri)
            loops.remove(spec.occurrenceId)?.let { handler.removeCallbacks(it) }
            if (spec.soundIntervalSeconds > 0) startReNotifyLoop(spec)
        }
        updateGroupSummary()
    }

    /**
     * Keep an alarm's controls on screen the way the system clock's alarm does.
     *
     * `setFullScreenIntent` only auto-launches [AlarmActivity] when the screen is
     * off or locked. When the device is unlocked and in active use, Android instead
     * shows a heads-up banner that collapses after a few seconds, leaving the alarm
     * ringing with its Done/Snooze controls buried in the notification shade. In
     * that one case we launch the activity ourselves so the surface stays up; the
     * lock-screen / screen-off case is already covered by the full-screen intent.
     *
     * `force` skips that gating: when the notification itself can't be shown there is
     * no full-screen intent to rely on, so we always launch the surface (it shows
     * over the lock screen) — the alarm must never ring with nothing to stop it.
     */
    private fun presentAlarmSurface(spec: AlarmSpec, force: Boolean = false) {
        if (!force) {
            val power = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
            if (!power.isInteractive || keyguard.isKeyguardLocked) return
        }
        try {
            startActivity(
                Intent(this, AlarmActivity::class.java)
                    .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
                    .putExtra("title", spec.title)
                    .putExtra("body", spec.body)
                    .putExtra("canSilence", spec.canSilence)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            )
        } catch (_: Exception) {
            // Background-activity-launch can be denied on some OS versions; the
            // heads-up banner and the ongoing notification (whose tap opens this
            // same surface) remain as the fallback.
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

    /**
     * Snooze, in guaranteed order: capture the spec, tear the current alert down
     * (clear() cancels alarms and wipes the store for this occurrence), THEN store +
     * arm the re-fire. Running inside the service's single-threaded command handler
     * makes the ordering deterministic — the re-fire can't be destroyed by a
     * trailing async stop. The re-fire keeps the spec's fidelity (chosen tone,
     * alarm-or-soft) so a snoozed alarm rings again as an alarm; the store entry
     * also keeps handledLocally() true, so a racing server fire/escalate push for
     * this occurrence stays suppressed instead of double-alerting.
     */
    private fun snoozeLocal(occurrenceId: String, minutes: Int) {
        // Prefer the live spec over the stored one: a locally-escalated ring holds
        // alarm=true in `active` while the store still has the soft pre-escalation
        // spec — and a snoozed alarm must ring again as an alarm when it returns.
        val spec = active[occurrenceId] ?: AlarmStore.find(this, occurrenceId)
        android.util.Log.i(
            "PersistAlarm",
            "snoozeLocal occ=$occurrenceId minutes=$minutes specFound=${spec != null}"
        )
        clear(occurrenceId)
        if (spec != null) {
            val snoozed = spec.copy(fireAtMs = System.currentTimeMillis() + minutes * 60_000L)
            AlarmStore.put(this, snoozed)
            AlarmPlugin.armAlarm(this, snoozed)
        }
    }

    /**
     * Silence an escalation: stop the alarm sound but keep the occurrence nagging.
     * Downgrades the spec to a non-alarm notification in place (no more full-screen
     * / looping sound), restarts its soft re-notify loop if one is configured, and
     * stops the continuous alarm sound unless another occurrence is still ringing.
     * The reminder stays FIRED — only Done/Snooze clear it.
     */
    private fun silenceOccurrence(occurrenceId: String) {
        val spec = active[occurrenceId] ?: return
        if (!spec.alarm) return
        val downgraded = spec.copy(alarm = false, canSilence = false)
        active[occurrenceId] = downgraded
        alarmIds.remove(occurrenceId)
        val notif = buildNotification(downgraded)
        if (foregroundId == occurrenceId) startForeground(notifId(occurrenceId), notif)
        else nm.notify(notifId(occurrenceId), notif)
        loops.remove(occurrenceId)?.let { handler.removeCallbacks(it) }
        if (downgraded.soundIntervalSeconds > 0) startReNotifyLoop(downgraded)
        if (active.values.none { it.alarm } && continuousAlarm) stopSound()
        // The alarm is no longer ringing for this occurrence; tear down its
        // full-screen surface so only the (downgraded) shade nag remains.
        dismissAlarmSurface(occurrenceId)
        // A downgraded alarm may now sit on a (minimized) channel, changing the group.
        updateGroupSummary()
    }

    /**
     * Tell any live full-screen [AlarmActivity] to finish. Pass an occurrence id to
     * dismiss only that one (it ignores the broadcast if it's showing a different
     * occurrence); pass null to dismiss whatever surface is up. The surface otherwise
     * only closes via its own Done/Snooze/Silence buttons, so this covers silence/ack/
     * snooze driven from the shade action or another device.
     */
    private fun dismissAlarmSurface(occurrenceId: String?) {
        val intent = Intent(AlarmActivity.ACTION_DISMISS).setPackage(packageName)
        if (occurrenceId != null) intent.putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
        sendBroadcast(intent)
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
        updateGroupSummary()
    }

    /**
     * Re-post every active notification so each lands on its (possibly new) channel
     * after a prominence change. A notification's channel can't change on an
     * in-place notify(), so each is cancelled then re-posted; the foreground-bound
     * one is detached first so the service stays alive across the swap. `postedAt`
     * is retained, so positions are preserved and no sound plays (audio is separate).
     */
    private fun restyleActive() {
        ensureChannels()
        var bound = false
        for ((id, spec) in active) {
            val notif = buildNotification(spec)
            if (!bound) {
                stopForeground(STOP_FOREGROUND_DETACH)
                nm.cancel(notifId(id))
                foregroundId = id
                startForeground(notifId(id), notif)
                bound = true
            } else {
                nm.cancel(notifId(id))
                nm.notify(notifId(id), notif)
            }
        }
        updateGroupSummary()
    }

    /**
     * After a resync, bring live notifications in line with the server: pick up an
     * edited reminder's title/body (e.g. a rename) and any per-reminder shade-
     * prominence change. Title/body update in place (same channel); a prominence
     * change that moves the channel needs a cancel + re-post (an in-place notify()
     * won't move a notification's channel). Prominence applies to soft notifications
     * only — alarms/escalations stay pinned to the alarm channel — but text updates
     * for everything. `postedAt` is retained so positions hold and no sound replays
     * (audio is separate). The live alarm/silence state is left untouched.
     */
    private fun refreshActive() {
        ensureChannels()
        for (id in active.keys.toList()) {
            val current = active[id] ?: continue
            val stored = AlarmStore.find(this, id) ?: continue
            val prominence = if (current.alarm) current.shadeProminence else stored.shadeProminence
            val updated = current.copy(title = stored.title, body = stored.body, shadeProminence = prominence)
            val channelChanged = channelFor(updated) != channelFor(current)
            if (updated.title == current.title && updated.body == current.body && !channelChanged) continue
            active[id] = updated
            val notif = buildNotification(updated)
            if (channelChanged) {
                // The channel moved — cancel then re-post (detach the foreground-bound
                // one first so the service stays alive across the swap).
                if (foregroundId == id) {
                    stopForeground(STOP_FOREGROUND_DETACH)
                    nm.cancel(notifId(id))
                    startForeground(notifId(id), notif)
                } else {
                    nm.cancel(notifId(id))
                    nm.notify(notifId(id), notif)
                }
            } else if (foregroundId == id) {
                startForeground(notifId(id), notif)
            } else {
                nm.notify(notifId(id), notif)
            }
        }
        updateGroupSummary()
    }

    /**
     * Which channel a notification posts to (visual prominence only):
     * alarms/escalations stay on the prominent alarm channel; otherwise the
     * reminder's own setting, or the device default when it's INHERIT.
     */
    private fun channelFor(spec: AlarmSpec): String {
        if (spec.alarm) return CHANNEL_ALARM
        val minimized = when (spec.shadeProminence) {
            "MINIMIZED" -> true
            "NORMAL" -> false
            else -> AlarmStore.defaultMinimized(this)
        }
        return if (minimized) CHANNEL_MINIMIZED else CHANNEL_NORMAL
    }

    private fun resolveUri(uriStr: String, defaultType: Int): android.net.Uri =
        if (uriStr.isNotEmpty()) android.net.Uri.parse(uriStr) else RingtoneManager.getDefaultUri(defaultType)

    /**
     * Keep the group summary in step with the live non-minimized notifications. The
     * summary is what collapses them to one status-bar icon; Android only needs it
     * once two or more share the group (a lone child shows on its own), so post it
     * then and cancel it otherwise. Minimized notifications are ungrouped and don't
     * count. The summary is silent (GROUP_ALERT_CHILDREN) so re-posting it on every
     * change never pops a banner.
     */
    private fun updateGroupSummary() {
        val grouped = active.values.count { channelFor(it) != CHANNEL_MINIMIZED }
        if (grouped < 2) {
            nm.cancel(GROUP_SUMMARY_ID)
            return
        }
        ensureChannels()
        val summary = NotificationCompat.Builder(this, CHANNEL_NORMAL)
            .setContentTitle("Reminders")
            .setContentText("$grouped active reminders")
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setGroup(GROUP_KEY)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .build()
        nm.notify(GROUP_SUMMARY_ID, summary)
    }

    private fun placeholderNotification(): android.app.Notification {
        ensureChannels()
        return NotificationCompat.Builder(this, CHANNEL_ALARM)
            .setContentTitle("Reminder")
            .setSmallIcon(R.drawable.ic_stat_bell)
            .build()
    }

    private fun buildNotification(spec: AlarmSpec): android.app.Notification {
        // The notification never carries audio — we play the chosen sound via
        // MediaPlayer — so every channel is silent; the channel only controls the
        // reminder's visual prominence in the shade (see channelFor).
        val channel = channelFor(spec)
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
                .putExtra("canSilence", spec.canSilence)
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
        // Silence: stop this escalation alarm but keep the reminder nagging.
        val silencePending = PendingIntent.getBroadcast(
            this,
            ("silence:" + spec.occurrenceId).hashCode(),
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_SILENCE)
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
        val builder = NotificationCompat.Builder(this, channel)
            .setContentTitle(spec.title)
            .setContentText(if (awaitingConfirm) "Tap \"Confirm done\" to mark complete" else spec.body)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setCategory(if (spec.alarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (spec.alarm) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setOngoing(spec.ongoing)
            .setAutoCancel(!spec.ongoing)
            .setWhen(posted)
            .setShowWhen(true)
            // Show full content on the lock screen so the user can see *which*
            // reminder is firing without unlocking — the alarm must be findable.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSortKey((Long.MAX_VALUE - posted).toString().padStart(20, '0'))
            // For an alarm, tapping the notification body brings up the full-screen
            // control surface (Done/Snooze) rather than opening the app, so once the
            // heads-up banner collapses the controls are still one tap away. Soft
            // reminders keep opening the app to view the reminder.
            .setContentIntent(if (spec.alarm) fullScreen else contentPending)
        if (awaitingConfirm) {
            builder.addAction(0, "Confirm done", confirmPending)
            builder.addAction(0, "Not yet", cancelDonePending)
        } else {
            builder.addAction(0, "Done", donePending)
            builder.addAction(0, "Snooze", snoozePending)
            // Escalation alarms also offer De-escalate (stop the alarm, keep nagging —
            // the user-facing label for the silence action).
            if (spec.alarm && spec.canSilence) builder.addAction(0, "De-escalate", silencePending)
        }
        if (spec.alarm) {
            builder.setFullScreenIntent(fullScreen, true)
        }
        if (spec.ongoing) {
            builder.setDeleteIntent(reshowPending)
        }
        // Bundle the non-minimized reminders under one group + summary so the status
        // bar shows a single icon (and the shade collapses them) instead of one icon
        // per reminder. Minimized ones stay ungrouped: they're low-importance, tucked
        // into the silent section with no status-bar icon, so they need no collapsing.
        // GROUP_ALERT_CHILDREN keeps the (silent) summary from ever stealing a child's
        // heads-up / full-screen alert.
        if (channel != CHANNEL_MINIMIZED) {
            builder.setGroup(GROUP_KEY).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
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
        // Done/Snooze/dismiss for this occurrence — close its full-screen surface too.
        dismissAlarmSurface(occurrenceId)
        AlarmPlugin.cancelAlarm(this, occurrenceId)
        AlarmStore.remove(this, occurrenceId)
        // Reset the sound-debounce so a future fire (or a snooze re-fire, which routes
        // through here via stopFor) sounds again.
        AlarmStore.clearSounded(this, occurrenceId)
        // Also drop any pending escalation timer for this occurrence.
        val escId = occurrenceId + AlarmReceiver.ESC_SUFFIX
        AlarmPlugin.cancelAlarm(this, escId)
        AlarmStore.remove(this, escId)

        if (active.isEmpty()) {
            clearAll()
            return
        }
        updateGroupSummary()
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
        nm.cancel(GROUP_SUMMARY_ID)
        dismissAlarmSurface(null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = nm
        // All channels are silent (we play the chosen tone ourselves via MediaPlayer);
        // they differ only in importance, which controls shade prominence:
        //  - ALARM/NORMAL = HIGH (main shade area, may pop up a heads-up banner)
        //  - MINIMIZED    = LOW  (collapsed "silent" section at the bottom, no pop-up)
        // (CHANNEL_ALARM keeps the legacy id so existing installs don't lose its
        // DND-bypass grant; alarms/escalations always use it.)
        if (manager.getNotificationChannel(CHANNEL_ALARM) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ALARM, "Alarms & escalations", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Ringing alarms and escalated reminders"
                    setSound(null, null)
                    enableVibration(false)
                    setBypassDnd(true)
                }
            )
        }
        if (manager.getNotificationChannel(CHANNEL_NORMAL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_NORMAL, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Persistent reminders shown in the main shade"
                    setSound(null, null)
                    enableVibration(false)
                    setBypassDnd(true)
                }
            )
        }
        if (manager.getNotificationChannel(CHANNEL_MINIMIZED) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_MINIMIZED, "Reminders (minimized)", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Reminders tucked into the collapsed section of the shade"
                    setSound(null, null)
                    enableVibration(false)
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
        const val ACTION_SILENCE = "ca.persistent.app.SERVICE_SILENCE"
        const val ACTION_RESTYLE = "ca.persistent.app.SERVICE_RESTYLE"
        const val ACTION_REFRESH = "ca.persistent.app.SERVICE_REFRESH"
        const val ACTION_ENSURE = "ca.persistent.app.SERVICE_ENSURE"
        const val ACTION_SNOOZE_LOCAL = "ca.persistent.app.SERVICE_SNOOZE_LOCAL"
        const val EXTRA_SNOOZE_MINUTES = "snoozeMinutes"
        const val DEFAULT_SNOOZE_MINUTES = 10
        // Don't re-play the same occurrence's sound within this window — de-dups an
        // on-device alarm and a redundant server push landing near-simultaneously.
        // Longer than the local-alarm-vs-push gap (~1-2 min), shorter than the ~15-min
        // background resync and the 10-min default snooze.
        private const val SOUND_DEBOUNCE_MS = 4 * 60_000L
        // Alarms/escalations keep the legacy channel id so existing installs retain
        // its DND-bypass grant; the two non-alarm channels split by prominence.
        private const val CHANNEL_ALARM = "reminders_silent"
        private const val CHANNEL_NORMAL = "reminders_normal"
        private const val CHANNEL_MINIMIZED = "reminders_minimized"
        private const val SENTINEL_ID = 4201
        // Group key + summary id that bundle the non-minimized reminders into one
        // status-bar icon (see updateGroupSummary / buildNotification).
        private const val GROUP_KEY = "ca.persistent.app.reminders"
        private const val GROUP_SUMMARY_ID = 4202
        private const val VIBRATE_KEY = "__vibrate__"

        // What's currently showing (and which of those are ringing as an alarm), so
        // a resync can re-arm future alarms without re-firing ones already on screen.
        val activeIds: MutableSet<String> = java.util.Collections.synchronizedSet(LinkedHashSet())
        val alarmIds: MutableSet<String> = java.util.Collections.synchronizedSet(LinkedHashSet())
        fun isActive(occurrenceId: String): Boolean = activeIds.contains(occurrenceId)
        fun isAlarmActive(occurrenceId: String): Boolean = alarmIds.contains(occurrenceId)

        /**
         * Clear any live notification whose occurrence isn't in the latest sync set
         * (`keepBaseIds` = the base occurrence ids the server still wants shown). This
         * is how a resync catches up on dismisses it missed while offline: an
         * occurrence acked/superseded/deleted elsewhere is no longer in the set, so its
         * lingering notification is stopped. Active ids are always base ids (an
         * escalation upgrades the base occurrence in place), so they compare directly.
         */
        fun cancelMissing(context: Context, keepBaseIds: Set<String>) {
            for (id in activeIds.toList()) {
                if (id !in keepBaseIds) stopFor(context, id)
            }
        }

        /** Bring the WebView app to the foreground (used by the notification tap). */
        fun launchAppPublic(context: Context) = launchApp(context)

        /**
         * Called by the confirm action: queue the ack and stop the alarm. Deliberately
         * does NOT launch the app — the WebView posts the queued ack when it next runs.
         */
        fun markDone(context: Context, occurrenceId: String) {
            PendingAckStore.add(context, occurrenceId)
            stopFor(context, occurrenceId)
            // Deliver the ack to the server promptly (not on the next 15-min cycle):
            // it stops nagging on other devices, and closes the race where the server
            // escalates-and-pushes an occurrence the user has already confirmed.
            SyncWorker.syncNow(context)
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
         * User pressed Silence here: queue the silence for the server (drained by the
         * WebView) and downgrade the local alarm to a soft nag. Does NOT ack/snooze.
         */
        fun silence(context: Context, occurrenceId: String) {
            PendingSilenceStore.add(context, occurrenceId)
            silenceLocal(context, occurrenceId)
            SyncWorker.syncNow(context)
        }

        /**
         * Silence driven by the server (another device already silenced it): downgrade
         * the local alarm without re-queuing a pending silence.
         */
        fun silenceLocal(context: Context, occurrenceId: String) {
            context.startService(
                Intent(context, AlarmService::class.java)
                    .setAction(ACTION_SILENCE)
                    .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
            )
        }

        /**
         * Snooze for `minutes`: stop the current alarm, re-arm the local re-fire, and
         * queue the snooze for the server (drained on the next sync) so it's
         * authoritative and syncs across devices. The escalation backstop stays
         * server-anchored to the original fire.
         *
         * The stop and the re-arm MUST run in that order inside the service: this
         * used to stopFor() (an async startService) and then store+arm the re-fire
         * directly — and the stop's clear() would land afterwards, cancelling the
         * just-armed re-fire and deleting its store entry. Every native snooze
         * silently lost its local re-fire (only server push could revive it), and the
         * emptied store made handledLocally() wave a duplicate fire/escalate push
         * through as a second, default-tone alarm.
         */
        fun snooze(context: Context, occurrenceId: String, minutes: Int) {
            PendingSnoozeStore.add(context, occurrenceId, minutes)
            context.startService(
                Intent(context, AlarmService::class.java)
                    .setAction(ACTION_SNOOZE_LOCAL)
                    .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
                    .putExtra(EXTRA_SNOOZE_MINUTES, minutes)
            )
            SyncWorker.syncNow(context)
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

        /**
         * Nudge the running service to re-post any live notification whose
         * per-reminder shade prominence changed in the latest resync. No-op when
         * nothing is showing, so it won't spin up the service needlessly.
         */
        fun refreshActiveStyles(context: Context) {
            if (activeIds.isNotEmpty()) {
                context.startService(Intent(context, AlarmService::class.java).setAction(ACTION_REFRESH))
            }
        }

        /**
         * Re-post any overdue soft nag whose notification isn't currently showing,
         * silently (see [ensureNags]) — the durable keep-alive that restores a nag the
         * OS removed when it killed the process/foreground service. Reads the persisted
         * [AlarmStore] so it works offline and from a cold start; only starts the
         * service when there's actually something overdue to (re)show, so it never
         * needlessly spins one up. The app is battery-exempt, so the background
         * foreground-service start is allowed.
         */
        fun ensureNags(context: Context) {
            val now = System.currentTimeMillis()
            val hasDue = AlarmStore.all(context).any {
                !it.alarm && it.fireAtMs <= now && !it.occurrenceId.endsWith(AlarmReceiver.ESC_SUFFIX)
            }
            if (!hasDue) return
            val intent = Intent(context, AlarmService::class.java).setAction(ACTION_ENSURE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        /**
         * Set the device-default shade prominence (for reminders set to INHERIT).
         * Persists immediately; only nudges the running service to re-post live
         * notifications when the value actually changed and something is showing, so
         * it's safe to call on every startup without needless re-posts.
         */
        fun setDefaultProminence(context: Context, minimized: Boolean) {
            val changed = AlarmStore.defaultMinimized(context) != minimized
            AlarmStore.setDefaultMinimized(context, minimized)
            if (changed && activeIds.isNotEmpty()) {
                context.startService(
                    Intent(context, AlarmService::class.java).setAction(ACTION_RESTYLE)
                )
            }
        }

        private fun launchApp(context: Context) {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (launch != null) context.startActivity(launch)
        }
    }
}
