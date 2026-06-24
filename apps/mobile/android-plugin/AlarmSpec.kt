package ca.persistent.app.alarm

import com.getcapacitor.PluginCall
import org.json.JSONObject

/** One scheduled alarm, mirrored from the JS ScheduledAlarm shape. */
data class AlarmSpec(
    val occurrenceId: String,
    val fireAtMs: Long,
    val title: String,
    val body: String,
    val soundIntervalSeconds: Int,
    // true = full alarm (looping sound + full-screen until Done); false = a normal
    // notification that sounds once.
    val alarm: Boolean,
    // true = stays put / re-appears if swiped away; false = ordinary dismissable.
    val ongoing: Boolean,
    // Chosen sound URI ("" = system default for the alarm/notification type).
    val soundUri: String,
    // Parent reminder id, so tapping the notification can open its editor.
    val reminderId: String = "",
    // true = an escalation alarm the user may silence back to a soft nag; false for
    // inherent ALARM reminders (no softer level to fall back to).
    val canSilence: Boolean = false,
    // Shade prominence (visual only): "INHERIT" (device default), "NORMAL", or
    // "MINIMIZED". Ignored for alarms/escalations, which always stay prominent.
    val shadeProminence: String = "INHERIT"
) {
    fun toJson(): JSONObject = JSONObject()
        .put("occurrenceId", occurrenceId)
        .put("fireAtMs", fireAtMs)
        .put("title", title)
        .put("body", body)
        .put("soundIntervalSeconds", soundIntervalSeconds)
        .put("alarm", alarm)
        .put("ongoing", ongoing)
        .put("soundUri", soundUri)
        .put("reminderId", reminderId)
        .put("canSilence", canSilence)
        .put("shadeProminence", shadeProminence)

    companion object {
        fun fromCall(call: PluginCall): AlarmSpec? {
            val occurrenceId = call.getString("occurrenceId") ?: return null
            val fireAtMs = call.getLong("fireAtMs") ?: return null
            return AlarmSpec(
                occurrenceId = occurrenceId,
                fireAtMs = fireAtMs,
                title = call.getString("title") ?: "Reminder",
                body = call.getString("body") ?: "",
                soundIntervalSeconds = call.getInt("soundIntervalSeconds") ?: 0,
                alarm = call.getBoolean("alarm") ?: false,
                ongoing = call.getBoolean("ongoing") ?: true,
                soundUri = call.getString("soundUri") ?: "",
                reminderId = call.getString("reminderId") ?: "",
                canSilence = call.getBoolean("canSilence") ?: false,
                shadeProminence = call.getString("shadeProminence") ?: "INHERIT"
            )
        }

        fun fromJson(json: JSONObject?): AlarmSpec? {
            if (json == null) return null
            val occurrenceId = json.optString("occurrenceId").ifEmpty { return null }
            if (!json.has("fireAtMs")) return null
            return AlarmSpec(
                occurrenceId = occurrenceId,
                fireAtMs = json.optLong("fireAtMs"),
                title = json.optString("title", "Reminder"),
                body = json.optString("body", ""),
                soundIntervalSeconds = json.optInt("soundIntervalSeconds", 0),
                alarm = json.optBoolean("alarm", false),
                ongoing = json.optBoolean("ongoing", true),
                soundUri = json.optString("soundUri", ""),
                reminderId = json.optString("reminderId", ""),
                canSilence = json.optBoolean("canSilence", false),
                shadeProminence = json.optString("shadeProminence", "INHERIT")
            )
        }
    }
}
