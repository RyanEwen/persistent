package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Snoozes the user made from the native notification that still need to be POSTed
 * to the server (which owns the authoritative snooze + escalation backstop). The
 * WebView drains these via AlarmPlugin.drainPendingSnoozes(); mirrors
 * PendingAckStore but carries the snooze duration.
 *
 * Each entry records WHEN it was picked: the server computes `snoozedUntil` from
 * the moment the POST arrives, and a queued snooze may not drain for many minutes
 * (background sync cadence), so drain() returns the REMAINING minutes — the user's
 * chosen end time is preserved instead of silently sliding later by the drain lag.
 */
object PendingSnoozeStore {
    private const val PREFS = "persistent_alarms"
    private const val KEY = "pending_snoozes"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(context: Context, occurrenceId: String, minutes: Int) {
        // Last write per occurrence wins (most recent snooze duration).
        val map = LinkedHashMap<String, Pair<Int, Long>>()
        for ((id, mins, at) in all(context)) map[id] = mins to at
        map[occurrenceId] = minutes to System.currentTimeMillis()
        write(context, map)
    }

    /**
     * Returns and clears the queued snoozes as (occurrenceId, minutes) pairs, with
     * minutes adjusted down by the time the entry sat queued (min 1 — an elapsed
     * snooze still posts, so the server re-fires it promptly and stays consistent).
     */
    fun drain(context: Context): List<Pair<String, Int>> {
        val now = System.currentTimeMillis()
        val current = all(context)
        prefs(context).edit().remove(KEY).apply()
        return current.map { (id, minutes, atMs) ->
            val elapsedMin = ((now - atMs) / 60_000L).toInt().coerceAtLeast(0)
            id to (minutes - elapsedMin).coerceAtLeast(1)
        }
    }

    private fun all(context: Context): List<Triple<String, Int, Long>> {
        val raw = prefs(context).getString(KEY, "[]") ?: "[]"
        val array = JSONArray(raw)
        return (0 until array.length()).mapNotNull {
            val obj = array.optJSONObject(it) ?: return@mapNotNull null
            val id = obj.optString("occurrenceId").ifEmpty { return@mapNotNull null }
            // Entries written before `atMs` existed count as picked now (full duration).
            Triple(id, obj.optInt("minutes", 10), obj.optLong("atMs", System.currentTimeMillis()))
        }
    }

    private fun write(context: Context, map: Map<String, Pair<Int, Long>>) {
        val array = JSONArray()
        for ((id, entry) in map) {
            array.put(JSONObject().put("occurrenceId", id).put("minutes", entry.first).put("atMs", entry.second))
        }
        prefs(context).edit().putString(KEY, array.toString()).apply()
    }
}
