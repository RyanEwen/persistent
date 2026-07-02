package ca.persistent.app.alarm

import android.content.Context
import android.content.Intent
import android.os.Build
import com.capacitorjs.plugins.pushnotifications.MessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM receiver for server-pushed reminder events — the cross-device / ad-hoc /
 * escalation backup to on-device exact alarms (see docs/alarm-architecture.md).
 *
 * It acts on the self-contained data payload even when the WebView/bridge is dead,
 * so a reminder fired, escalated, silenced, or dismissed on the server still
 * reaches a fully-closed app. It extends Capacitor's MessagingService and calls
 * through to super, so the @capacitor/push-notifications JS events still fire when
 * the bridge is alive (token registration, foreground resync). It is registered in
 * place of Capacitor's own service via the manifest (see setup-android.mjs); both
 * the native action and the JS resync are idempotent, so the overlap is harmless.
 *
 * Mirrors the web service worker (apps/web/public/push-handler.js): dismiss clears
 * the notification; fire/escalate show it; silence downgrades a ringing escalation.
 * Fidelity note: a pushed fire carries no chosen sound URI / shade prominence
 * (those live in the WebView's settings), so it falls back to defaults — the
 * on-device scheduled alarm stays the full-fidelity primary path. High-priority FCM
 * messages grant the temporary allowance to start the foreground service here.
 */
class FcmService : MessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        handle(applicationContext, message.data)
    }

    private fun handle(context: Context, data: Map<String, String>) {
        val type = data["type"] ?: return
        val occurrenceId = data["occurrenceId"]
        when (type) {
            // Acked / superseded / deleted elsewhere: clear the nag and any escalation
            // alarm. Guarded — stopFor drives the running service; if nothing's showing
            // (and the service isn't up) there's nothing to clear.
            "dismiss" -> if (occurrenceId != null) {
                runCatching { AlarmService.stopFor(context, occurrenceId) }
                runCatching { AlarmService.stopFor(context, occurrenceId + AlarmReceiver.ESC_SUFFIX) }
            }
            // Silenced elsewhere: stop this device's ringing alarm but keep nagging.
            "silence" -> if (occurrenceId != null) runCatching { AlarmService.silenceLocal(context, occurrenceId) }
            // The on-device scheduled alarm is the full-fidelity primary (it rings with
            // the user's CHOSEN tone and, for alarms, the full-screen surface). A fire/
            // escalate push is only a BACKUP for when this device didn't schedule the
            // occurrence locally (web-only, never synced, or a cross-device nudge). If we
            // already have it — armed in AlarmStore or showing — skip the push so it
            // doesn't double-alert with the default tone (this service can't read the
            // WebView's chosen sound, so its fallback is always the system default).
            "fire", "escalate" -> if (occurrenceId != null) {
                val local = handledLocally(context, occurrenceId)
                android.util.Log.i("PersistAlarm", "fcm $type occ=$occurrenceId handledLocally=$local")
                if (!local) startAlarm(context, type, occurrenceId, data)
            }
            // "sync": no self-contained action, and a resync needs the WebView's
            // session cookie; super() already forwarded to JS, which resyncs when the
            // bridge is alive. A fully-closed app catches up on its next open.
        }
    }

    /**
     * Whether this device already owns the occurrence locally, so a fire/escalate
     * push would be a redundant second alert. True if it's currently showing/ringing
     * or still scheduled in [AlarmStore] (the base alarm or its `::esc` escalation) —
     * i.e. the on-device exact alarm has it (or already handled it) with full fidelity.
     * Only when neither holds is the push the sole surface, so it acts.
     */
    private fun handledLocally(context: Context, occurrenceId: String): Boolean =
        AlarmService.isActive(occurrenceId) ||
            AlarmStore.find(context, occurrenceId) != null ||
            AlarmStore.find(context, occurrenceId + AlarmReceiver.ESC_SUFFIX) != null

    private fun startAlarm(context: Context, type: String, occurrenceId: String, data: Map<String, String>) {
        val spec = AlarmSpec(
            occurrenceId = occurrenceId,
            fireAtMs = System.currentTimeMillis(),
            title = data["title"] ?: "Reminder",
            body = data["body"] ?: "",
            soundIntervalSeconds = data["soundIntervalSeconds"]?.toIntOrNull() ?: 0,
            alarm = data["alarm"] == "true" || type == "escalate",
            ongoing = true,
            soundUri = "", // the chosen tone lives in the WebView's settings; default here
            reminderId = data["reminderId"] ?: "",
            canSilence = type == "escalate",
            shadeProminence = "INHERIT"
        )
        // Persist so a reboot / resync keeps it, then show it now.
        AlarmStore.put(context, spec)
        val intent = Intent(context, AlarmService::class.java).apply {
            action = AlarmService.ACTION_START
            putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
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
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }
}
