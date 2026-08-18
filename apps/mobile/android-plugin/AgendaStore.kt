package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The device's **agenda**: the wider reminder set it may LIST, as against the alarm
 * set it arms ([AlarmStore]).
 *
 * The server sends both from one sync (`GET /api/sync/occurrences` — `alarms` and
 * `agenda`). They are stored apart on purpose, and this is the important part: every
 * code path that arms an exact alarm, re-arms after boot, or re-posts a nag iterates
 * [AlarmStore]. Nothing reads this but the Android Auto screens, so an agenda entry
 * cannot ring, cannot survive as a notification, and cannot be acked into existence —
 * it is a row of text with a time on it.
 *
 * Shared by both flavors even though only `direct` compiles the car screens: the sync
 * that writes it is shared, and a writer that had to know whether a reader was
 * compiled in would be the kind of coupling `CarListRefresh` avoids the same way.
 *
 * Not merged with the alarm set here either. [CarReminders] does that at read time,
 * where the alarm set wins for any occurrence in both — it is what the phone is
 * actually about to do.
 */
data class AgendaEntry(
    /** The firing this is about; empty for a note, which never has one. */
    val occurrenceId: String,
    val reminderId: String,
    val title: String,
    /** The firing's unticked checklist items / description, already cut server-side. */
    val body: String,
    /** Epoch ms it is due; 0 for a note, which is never due. */
    val fireAtMs: Long,
    /** A note: kept to be read, with no firing to act on. */
    val note: Boolean
) {
    fun toJson(): JSONObject = JSONObject()
        .put("occurrenceId", occurrenceId)
        .put("reminderId", reminderId)
        .put("title", title)
        .put("body", body)
        .put("fireAtMs", fireAtMs)
        .put("note", note)

    companion object {
        fun fromJson(json: JSONObject?): AgendaEntry? {
            if (json == null) return null
            val reminderId = json.optString("reminderId")
            if (reminderId.isEmpty()) return null
            return AgendaEntry(
                occurrenceId = json.optString("occurrenceId"),
                reminderId = reminderId,
                title = json.optString("title", "Reminder"),
                body = json.optString("body", ""),
                fireAtMs = json.optLong("fireAtMs", 0L),
                note = json.optBoolean("note", false)
            )
        }
    }
}

object AgendaStore {
    private const val PREFS = "persistent_agenda"
    private const val KEY = "agenda"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun all(context: Context): List<AgendaEntry> {
        val raw = prefs(context).getString(KEY, "[]") ?: "[]"
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        val out = mutableListOf<AgendaEntry>()
        for (i in 0 until array.length()) {
            AgendaEntry.fromJson(array.optJSONObject(i))?.let { out.add(it) }
        }
        return out
    }

    /** Replace the whole agenda — it is a snapshot of the server's answer, not a log. */
    fun replaceAll(context: Context, entries: List<AgendaEntry>) {
        val array = JSONArray()
        for (entry in entries) array.put(entry.toJson())
        prefs(context).edit().putString(KEY, array.toString()).apply()
    }
}
