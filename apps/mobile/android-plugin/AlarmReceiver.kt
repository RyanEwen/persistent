package ca.persistent.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Receives the AlarmManager fire (and the notification "Done"/"Snooze" actions)
 * and drives [AlarmService] accordingly.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val occurrenceId = intent.getStringExtra(EXTRA_OCCURRENCE_ID) ?: return
        when (intent.action) {
            ACTION_FIRE -> {
                val spec = AlarmStore.find(context, occurrenceId) ?: return
                // An escalation timer (<id>::esc) upgrades the *base* occurrence to
                // an alarm in place, so it shares the one notification + sound and a
                // single Done clears it. The esc spec already carries alarm=true.
                val isEsc = occurrenceId.endsWith(ESC_SUFFIX)
                val displayId = if (isEsc) occurrenceId.removeSuffix(ESC_SUFFIX) else occurrenceId
                val serviceIntent = Intent(context, AlarmService::class.java).apply {
                    action = AlarmService.ACTION_START
                    putExtra(EXTRA_OCCURRENCE_ID, displayId)
                    putExtra("title", spec.title)
                    putExtra("body", spec.body)
                    putExtra("soundIntervalSeconds", spec.soundIntervalSeconds)
                    putExtra("alarm", spec.alarm)
                    putExtra("ongoing", spec.ongoing)
                    putExtra("soundUri", spec.soundUri)
                    putExtra("reminderId", spec.reminderId)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                // The escalation timer is one-shot; consume it so a resync can't re-fire it.
                if (isEsc) {
                    AlarmStore.remove(context, occurrenceId)
                    AlarmPlugin.cancelAlarm(context, occurrenceId)
                }
            }
            ACTION_OPEN -> {
                // Tapping the notification body: remember which reminder to open,
                // then bring the app forward (the WebView navigates on resume).
                val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID)
                if (!reminderId.isNullOrEmpty()) PendingNavStore.set(context, reminderId)
                AlarmService.launchAppPublic(context)
            }
            ACTION_DONE -> {
                // Stop the alarm immediately; the web layer posts the ack via the
                // bridge when it next runs (AlarmService also enqueues an ack intent).
                AlarmService.markDone(context, occurrenceId)
            }
            ACTION_SNOOZE -> {
                AlarmService.snooze(context, occurrenceId)
            }
            ACTION_RESHOW -> {
                val serviceIntent = Intent(context, AlarmService::class.java)
                    .setAction(AlarmService.ACTION_RESHOW)
                    .putExtra(EXTRA_OCCURRENCE_ID, occurrenceId)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }

    companion object {
        const val ACTION_FIRE = "ca.persistent.app.ALARM_FIRE"
        const val ACTION_DONE = "ca.persistent.app.ALARM_DONE"
        const val ACTION_SNOOZE = "ca.persistent.app.ALARM_SNOOZE"
        const val ACTION_RESHOW = "ca.persistent.app.ALARM_RESHOW"
        const val ACTION_OPEN = "ca.persistent.app.ALARM_OPEN"
        const val EXTRA_OCCURRENCE_ID = "occurrenceId"
        const val EXTRA_REMINDER_ID = "reminderId"
        /** Suffix marking the escalation timer for an occurrence (see nativeSync.ts). */
        const val ESC_SUFFIX = "::esc"
    }
}
