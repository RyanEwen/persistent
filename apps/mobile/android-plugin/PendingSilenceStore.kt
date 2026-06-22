package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray

/**
 * Occurrence ids whose escalation the user silenced natively (stop the alarm but
 * keep nagging) that still need to be POSTed to the server. The WebView drains
 * these (it holds the session cookie) via AlarmPlugin.drainPendingSilences().
 */
object PendingSilenceStore {
    private const val PREFS = "persistent_alarms"
    private const val KEY = "pending_silences"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(context: Context, occurrenceId: String) {
        val list = all(context).toMutableSet()
        list.add(occurrenceId)
        write(context, list)
    }

    fun all(context: Context): List<String> {
        val raw = prefs(context).getString(KEY, "[]") ?: "[]"
        val array = JSONArray(raw)
        return (0 until array.length()).map { array.optString(it) }.filter { it.isNotEmpty() }
    }

    fun drain(context: Context): List<String> {
        val current = all(context)
        write(context, emptySet())
        return current
    }

    private fun write(context: Context, ids: Set<String>) {
        val array = JSONArray()
        for (id in ids) array.put(id)
        prefs(context).edit().putString(KEY, array.toString()).apply()
    }
}
