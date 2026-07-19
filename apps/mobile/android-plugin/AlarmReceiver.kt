package ca.persistent.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.RemoteInput

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
                    putExtra("canSilence", spec.canSilence)
                    putExtra("shadeProminence", spec.shadeProminence)
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
            ACTION_DONE -> {
                // First tap on the notification's "Done": do NOT ack yet. Swap the
                // notification into a confirm state (Confirm done / Not yet) so an
                // accidental pocket tap can't dismiss the nag. The alarm keeps ringing.
                AlarmService.promptConfirm(context, occurrenceId)
            }
            ACTION_CONFIRM -> {
                // The deliberate second tap (or the full-screen alarm activity's Done):
                // queue the ack and stop the alarm. Intentionally does NOT open the app
                // — the web layer posts the queued ack when it next runs.
                AlarmService.markDone(context, occurrenceId)
            }
            ACTION_CANCEL_DONE -> {
                // Backed out of the confirm prompt: restore the normal Done/Snooze
                // notification. The alarm was never interrupted.
                AlarmService.cancelConfirm(context, occurrenceId)
            }
            ACTION_SNOOZE -> {
                val minutes = intent.getIntExtra(EXTRA_MINUTES, AlarmService.DEFAULT_SNOOZE_MINUTES)
                AlarmService.snooze(context, occurrenceId, minutes)
            }
            ACTION_SILENCE -> {
                // Stop this escalation alarm but keep the reminder nagging. Queues a
                // pending silence for the server and downgrades the local alarm.
                AlarmService.silence(context, occurrenceId)
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
            ACTION_CAR_REPLY -> {
                // Reply from Android Auto (voice/inline): parse it as done/snooze/silence.
                val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_CAR_REPLY)
                AlarmService.handleCarReply(context, occurrenceId, reply)
            }
            ACTION_CAR_MARK_READ -> {
                // Android Auto requires a mark-as-read action, but reading/dismissing a
                // nag in the car must NEVER satisfy the persistence guarantee — so this
                // is a deliberate no-op. The occurrence stays FIRED until an explicit Done.
            }
        }
    }

    companion object {
        const val ACTION_FIRE = "ca.persistent.app.ALARM_FIRE"
        const val ACTION_DONE = "ca.persistent.app.ALARM_DONE"
        const val ACTION_CONFIRM = "ca.persistent.app.ALARM_CONFIRM"
        const val ACTION_CANCEL_DONE = "ca.persistent.app.ALARM_CANCEL_DONE"
        const val ACTION_SNOOZE = "ca.persistent.app.ALARM_SNOOZE"
        const val ACTION_SILENCE = "ca.persistent.app.ALARM_SILENCE"
        const val ACTION_RESHOW = "ca.persistent.app.ALARM_RESHOW"
        // Android Auto notification actions (reply is parsed; mark-as-read is a no-op).
        const val ACTION_CAR_REPLY = "ca.persistent.app.ALARM_CAR_REPLY"
        const val ACTION_CAR_MARK_READ = "ca.persistent.app.ALARM_CAR_MARK_READ"
        const val KEY_CAR_REPLY = "carReply"
        const val EXTRA_OCCURRENCE_ID = "occurrenceId"
        const val EXTRA_REMINDER_ID = "reminderId"
        const val EXTRA_MINUTES = "minutes"
        /** Suffix marking the escalation timer for an occurrence (see nativeSync.ts). */
        const val ESC_SUFFIX = "::esc"
    }
}
