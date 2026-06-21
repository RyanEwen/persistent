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
                val serviceIntent = Intent(context, AlarmService::class.java).apply {
                    action = AlarmService.ACTION_START
                    putExtra(EXTRA_OCCURRENCE_ID, occurrenceId)
                    putExtra("title", spec.title)
                    putExtra("body", spec.body)
                    putExtra("soundIntervalSeconds", spec.soundIntervalSeconds)
                    putExtra("alarm", spec.alarm)
                    putExtra("ongoing", spec.ongoing)
                    putExtra("soundUri", spec.soundUri)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
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
        const val EXTRA_OCCURRENCE_ID = "occurrenceId"
    }
}
