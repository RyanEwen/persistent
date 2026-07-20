package ca.persistent.app.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.app.Activity
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray

/**
 * Native bridge for on-device exact alarms.
 *
 * Schedules `AlarmManager.setExactAndAllowWhileIdle` alarms that survive Doze.
 * When one fires, [AlarmReceiver] starts [AlarmService], which posts an ongoing,
 * full-screen, looping-sound notification that only "Done" can clear. Schedules
 * are mirrored in [AlarmStore] so [BootReceiver] can re-arm them after a reboot.
 *
 * Place this file under the generated Android project at
 * android/app/src/main/java/ca/persistent/app/alarm/ and register the plugin in
 * MainActivity (see README.md).
 */
@CapacitorPlugin(name = "AlarmPlugin")
class AlarmPlugin : Plugin() {

    @PluginMethod
    fun schedule(call: PluginCall) {
        val alarm = AlarmSpec.fromCall(call) ?: run {
            call.reject("Invalid alarm payload")
            return
        }
        AlarmStore.put(context, alarm)
        armAlarm(context, alarm)
        call.resolve()
    }

    @PluginMethod
    fun scheduleAll(call: PluginCall) {
        val array: JSONArray = call.getArray("alarms") ?: JSONArray()
        val incoming = mutableListOf<AlarmSpec>()
        for (i in 0 until array.length()) {
            AlarmSpec.fromJson(array.optJSONObject(i))?.let { incoming.add(it) }
        }
        scheduleAll(context, incoming)
        call.resolve()
    }

    /** Mirror the config the background [SyncWorker] needs but can't read from the WebView. */
    @PluginMethod
    fun setSyncConfig(call: PluginCall) {
        val apiBaseUrl = call.getString("apiBaseUrl") ?: ""
        // Capture the session cookie HERE, in the WebView process, where CookieManager
        // is backed by a live cookie store. The background SyncWorker runs in a process
        // with NO WebView, where CookieManager.getCookie() returns null — so it cannot
        // read the cookie itself; we mirror it into AlarmStore for it. (It's HttpOnly,
        // so the JS side can't read it either — this native read is the only way.)
        val cm = android.webkit.CookieManager.getInstance()
        runCatching { cm.flush() }
        val fresh = if (apiBaseUrl.isNotEmpty()) cm.getCookie(apiBaseUrl) else null
        // Keep the previously-captured cookie if this read came back empty, so we never
        // clobber a working cookie with nothing.
        val cookie = if (fresh != null && fresh.contains("persistent_auth=")) fresh else AlarmStore.authCookie(context)
        AlarmStore.setSyncConfig(
            context,
            apiBaseUrl = apiBaseUrl,
            alarmSoundUri = call.getString("alarmSoundUri") ?: "",
            notificationSoundUri = call.getString("notificationSoundUri") ?: "",
            authCookie = cookie
        )
        call.resolve()
    }

    /** Enqueue the periodic background re-sync (idempotent). */
    @PluginMethod
    fun ensureBackgroundSync(call: PluginCall) {
        SyncWorker.ensureScheduled(context)
        call.resolve()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val occurrenceId = call.getString("occurrenceId") ?: run {
            call.reject("occurrenceId required")
            return
        }
        cancelAlarm(context, occurrenceId)
        AlarmStore.remove(context, occurrenceId)
        AlarmService.stopFor(context, occurrenceId)
        call.resolve()
    }

    /** Stop a ringing escalation alarm but keep its notification nagging (no ack). */
    @PluginMethod
    fun silence(call: PluginCall) {
        val occurrenceId = call.getString("occurrenceId") ?: run {
            call.reject("occurrenceId required")
            return
        }
        // Server-driven (already recorded server-side): downgrade locally without
        // re-queuing a pending silence.
        AlarmService.silenceLocal(context, occurrenceId)
        call.resolve()
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        for (existing in AlarmStore.all(context)) cancelAlarm(context, existing.occurrenceId)
        AlarmStore.replaceAll(context, emptyList())
        AlarmService.stopAll(context)
        call.resolve()
    }

    /** Set the device-default shade prominence and re-post live notifications. */
    @PluginMethod
    fun setDefaultShadeProminence(call: PluginCall) {
        val minimized = call.getBoolean("minimized") ?: false
        AlarmService.setDefaultProminence(context, minimized)
        call.resolve()
    }

    @PluginMethod
    fun canScheduleExactAlarms(call: PluginCall) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.canScheduleExactAlarms() else true
        call.resolve(JSObject().put("allowed", allowed))
    }

    /**
     * Whether a fired alarm can actually be presented to the user. `notifications`
     * false (POST_NOTIFICATIONS denied) is the worst case — the alarm would ring
     * with no visible/stoppable surface — so the app warns the user to fix it before
     * an alarm strikes. `fullScreen`/`exactAlarms` degrade reliability without fully
     * hiding the alarm.
     */
    @PluginMethod
    fun alarmReadiness(call: PluginCall) {
        val notifications = androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val fullScreen =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) nm.canUseFullScreenIntent() else true
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val exactAlarms =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) alarmManager.canScheduleExactAlarms() else true
        call.resolve(
            JSObject()
                .put("notifications", notifications)
                .put("fullScreen", fullScreen)
                .put("exactAlarms", exactAlarms)
                .put("overlay", canShowAlarmSurfaceWhileUnlocked())
        )
    }

    /**
     * Whether a ringing alarm can take over the screen while the device is *unlocked*.
     *
     * Android 15 refuses the activity launch from our foreground service unless the
     * app is exempt from the background-activity-launch rules, and "display over
     * other apps" is the exemption we hold (see AlarmService.presentAlarmSurface).
     * Below Android 15 the launch is allowed regardless, so report true there rather
     * than nagging for a permission that would change nothing.
     */
    private fun canShowAlarmSurfaceWhileUnlocked(): Boolean =
        if (Build.VERSION.SDK_INT >= 35) Settings.canDrawOverlays(context) else true

    /** Open the system "display over other apps" screen for this app. */
    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
            } catch (_: Exception) {
                // Some OEMs don't expose this screen; the heads-up banner remains.
            }
        }
        call.resolve(JSObject().put("granted", canShowAlarmSurfaceWhileUnlocked()))
    }

    @PluginMethod
    fun drainPendingAcks(call: PluginCall) {
        val ids = PendingAckStore.drain(context)
        val array = JSONArray()
        for (id in ids) array.put(id)
        call.resolve(JSObject().put("occurrenceIds", array))
    }

    /** Return + clear the reminder id from a tapped notification, if any. */
    @PluginMethod
    fun consumePendingNavigation(call: PluginCall) {
        val reminderId = PendingNavStore.consume(context)
        call.resolve(JSObject().put("reminderId", reminderId ?: ""))
    }

    /** Drain native snoozes awaiting POST to the server. */
    @PluginMethod
    fun drainPendingSnoozes(call: PluginCall) {
        val array = JSONArray()
        for ((id, minutes) in PendingSnoozeStore.drain(context)) {
            array.put(JSObject().put("occurrenceId", id).put("minutes", minutes))
        }
        call.resolve(JSObject().put("snoozes", array))
    }

    /** Drain native silences awaiting POST to the server. */
    @PluginMethod
    fun drainPendingSilences(call: PluginCall) {
        val ids = PendingSilenceStore.drain(context)
        val array = JSONArray()
        for (id in ids) array.put(id)
        call.resolve(JSObject().put("occurrenceIds", array))
    }

    /** Open the system ringtone picker so the user can choose a sound. */
    @PluginMethod
    fun pickSound(call: PluginCall) {
        val ringtoneType =
            if (call.getString("type") == "notification") RingtoneManager.TYPE_NOTIFICATION else RingtoneManager.TYPE_ALARM
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
            putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, ringtoneType)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
            putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Choose sound")
            call.getString("current")?.takeIf { it.isNotEmpty() }?.let {
                putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(it))
            }
        }
        startActivityForResult(call, intent, "soundPicked")
    }

    @ActivityCallback
    private fun soundPicked(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }
        @Suppress("DEPRECATION")
        val uri: Uri? = result.data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        val title = uri?.let { RingtoneManager.getRingtone(context, it)?.getTitle(context) } ?: "Default"
        call.resolve(JSObject().put("uri", uri?.toString() ?: "").put("title", title))
    }

    /**
     * Ensure the app may launch its full-screen alarm over the lock screen. On
     * Android 14+ `USE_FULL_SCREEN_INTENT` is user-grantable and off by default for
     * non-calling/alarm apps; without it the escalation only shows a heads-up that
     * collapses, so the user can lose the alarm among other notifications. Returns
     * whether it's allowed and, if not, opens the per-app settings to grant it.
     */
    @PluginMethod
    fun ensureFullScreenIntent(call: PluginCall) {
        var allowed = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            allowed = manager.canUseFullScreenIntent()
            if (!allowed) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    context.startActivity(intent)
                } catch (_: Exception) {
                    // Some OEMs don't expose this screen; the heads-up banner remains.
                }
            }
        }
        call.resolve(JSObject().put("allowed", allowed))
    }

    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
            } catch (_: Exception) {
                // Some OEMs don't expose this intent; ignore and report not-granted.
            }
        }
        call.resolve(JSObject().put("granted", false))
    }

    companion object {
        /**
         * Reconcile the on-device alarm set to [incoming] and re-arm. Shared by the
         * JS `scheduleAll` bridge call and the native [SyncWorker], so a foreground
         * sync and an autonomous background sync arm alarms identically.
         */
        fun scheduleAll(context: Context, incoming: List<AlarmSpec>) {
            // Replace the whole set: cancel everything we knew, then arm the new list.
            for (existing in AlarmStore.all(context)) cancelAlarm(context, existing.occurrenceId)
            AlarmStore.replaceAll(context, incoming)
            // Drop any live notification whose occurrence this sync no longer lists
            // (acked / superseded / deleted elsewhere while we were offline and — with
            // FCM off — couldn't get the dismiss). Otherwise a stale notification lingers,
            // and when a newer firing arrived meanwhile the user sees both: the old name
            // and the new. Sync's id is the base occurrence; escalation rides the base.
            val keepBaseIds = incoming.map { it.occurrenceId.removeSuffix(AlarmReceiver.ESC_SUFFIX) }.toSet()
            AlarmService.cancelMissing(context, keepBaseIds)
            val now = System.currentTimeMillis()
            for (alarm in incoming) {
                if (alarm.fireAtMs <= now) {
                    // Past-due: the fire already happened. A soft nag is (re)posted
                    // SILENTLY by ensureNags below, so a resync never re-sounds it;
                    // only an alarm/escalation still needs to ring — re-fire it unless
                    // it's already ringing.
                    if (!alarm.alarm) continue
                    val base = alarm.occurrenceId.removeSuffix(AlarmReceiver.ESC_SUFFIX)
                    val isEsc = base != alarm.occurrenceId
                    val alreadyRinging = if (isEsc) AlarmService.isAlarmActive(base) else AlarmService.isActive(base)
                    if (alreadyRinging) continue
                }
                armAlarm(context, alarm)
            }
            // Restore/maintain any overdue soft nag whose notification the OS dropped
            // (process/foreground-service killed) — silently, so it's present until Done.
            AlarmService.ensureNags(context)
            // A live reminder may have been edited in this sync (renamed, body or
            // per-reminder prominence changed); re-post any active notification so its
            // text and channel match the server.
            AlarmService.refreshActiveStyles(context)
        }

        /** Build the PendingIntent that fires [AlarmReceiver] for an occurrence. */
        fun firePendingIntent(context: Context, occurrenceId: String): PendingIntent {
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                action = AlarmReceiver.ACTION_FIRE
                putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
            }
            return PendingIntent.getBroadcast(
                context,
                occurrenceId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        fun armAlarm(context: Context, alarm: AlarmSpec) {
            val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pending = firePendingIntent(context, alarm.occurrenceId)
            // Exact + allow-while-idle so it fires precisely even in Doze.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                // Fall back to a best-effort inexact alarm if exact isn't permitted.
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.fireAtMs, pending)
            } else {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.fireAtMs, pending)
            }
        }

        fun cancelAlarm(context: Context, occurrenceId: String) {
            val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            manager.cancel(firePendingIntent(context, occurrenceId))
        }
    }
}
