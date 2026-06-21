package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Snoozes the user made from the native notification that still need to be POSTed
 * to the server (which owns the authoritative snooze + escalation backstop). The
 * WebView drains these via AlarmPlugin.drainPendingSnoozes(); mirrors
 * PendingAckStore but carries the snooze duration.
 */
object PendingSnoozeStore {
    private const val PREFS = "persistent_alarms"
    private const val KEY = "pending_snoozes"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(context: Context, occurrenceId: String, minutes: Int) {
        // Last write per occurrence wins (most recent snooze duration).
        val map = LinkedHashMap<String, Int>()
        for (entry in all(context)) map[entry.first] = entry.second
        map[occurrenceId] = minutes
        write(context, map)
    }

    /** Returns and clears the queued snoozes as (occurrenceId, minutes) pairs. */
    fun drain(context: Context): List<Pair<String, Int>> {
        val current = all(context)
        prefs(context).edit().remove(KEY).apply()
        return current
    }

    private fun all(context: Context): List<Pair<String, Int>> {
        val raw = prefs(context).getString(KEY, "[]") ?: "[]"
        val array = JSONArray(raw)
        return (0 until array.length()).mapNotNull {
            val obj = array.optJSONObject(it) ?: return@mapNotNull null
            val id = obj.optString("occurrenceId").ifEmpty { return@mapNotNull null }
            id to obj.optInt("minutes", 10)
        }
    }

    private fun write(context: Context, map: Map<String, Int>) {
        val array = JSONArray()
        for ((id, minutes) in map) array.put(JSONObject().put("occurrenceId", id).put("minutes", minutes))
        prefs(context).edit().putString(KEY, array.toString()).apply()
    }
}
