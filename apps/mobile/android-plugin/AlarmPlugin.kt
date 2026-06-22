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
        // Replace the whole set: cancel everything we knew, then arm the new list.
        for (existing in AlarmStore.all(context)) cancelAlarm(context, existing.occurrenceId)
        AlarmStore.replaceAll(context, incoming)
        val now = System.currentTimeMillis()
        for (alarm in incoming) {
            // Don't re-fire a past-due alarm that's already on screen — otherwise
            // every resync (resume / WS event) would re-show & re-sound it. Future
            // alarms always arm; a due one only (re)fires if it isn't already active.
            if (alarm.fireAtMs <= now) {
                val base = alarm.occurrenceId.removeSuffix(AlarmReceiver.ESC_SUFFIX)
                val isEsc = base != alarm.occurrenceId
                val alreadyHandled = if (isEsc) AlarmService.isAlarmActive(base) else AlarmService.isActive(base)
                if (alreadyHandled) continue
            }
            armAlarm(context, alarm)
        }
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

    @PluginMethod
    fun canScheduleExactAlarms(call: PluginCall) {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.canScheduleExactAlarms() else true
        call.resolve(JSObject().put("allowed", allowed))
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
