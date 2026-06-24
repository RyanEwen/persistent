package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray

/**
 * Persists the scheduled-alarm set in SharedPreferences so [BootReceiver] can
 * re-arm exact alarms after a reboot (AlarmManager alarms don't survive reboot).
 */
object AlarmStore {
    private const val PREFS = "persistent_alarms"
    private const val KEY = "alarms"
    // Device-default shade prominence for reminders set to INHERIT (visual only).
    private const val KEY_DEFAULT_MINIMIZED = "default_minimized"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun defaultMinimized(context: Context): Boolean = prefs(context).getBoolean(KEY_DEFAULT_MINIMIZED, false)

    fun setDefaultMinimized(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_DEFAULT_MINIMIZED, value).apply()
    }

    fun all(context: Context): List<AlarmSpec> {
        val raw = prefs(context).getString(KEY, "[]") ?: "[]"
        val array = JSONArray(raw)
        val out = mutableListOf<AlarmSpec>()
        for (i in 0 until array.length()) {
            AlarmSpec.fromJson(array.optJSONObject(i))?.let { out.add(it) }
        }
        return out
    }

    fun replaceAll(context: Context, alarms: List<AlarmSpec>) {
        val array = JSONArray()
        for (alarm in alarms) array.put(alarm.toJson())
        prefs(context).edit().putString(KEY, array.toString()).apply()
    }

    fun put(context: Context, alarm: AlarmSpec) {
        val next = all(context).filter { it.occurrenceId != alarm.occurrenceId } + alarm
        replaceAll(context, next)
    }

    fun remove(context: Context, occurrenceId: String) {
        replaceAll(context, all(context).filter { it.occurrenceId != occurrenceId })
    }

    fun find(context: Context, occurrenceId: String): AlarmSpec? =
        all(context).firstOrNull { it.occurrenceId == occurrenceId }
}
