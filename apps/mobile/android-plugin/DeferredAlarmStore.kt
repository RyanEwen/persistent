package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray

/** Durable live alarm specs waiting for a call to end, including offline escalations. */
object DeferredAlarmStore {
    private const val KEY = "call_deferred_alarms"

    /** Reads full specs because the scheduled base entry may still be a soft reminder. */
    fun all(context: Context): List<AlarmSpec> {
        val raw = context.getSharedPreferences("persistent_alarms", Context.MODE_PRIVATE)
            .getString(KEY, "[]") ?: "[]"
        val array = JSONArray(raw)
        return (0 until array.length()).mapNotNull { AlarmSpec.fromJson(array.optJSONObject(it)) }
    }

    /** Replaces the waiting set; an empty set also clears durable recovery state. */
    fun replace(context: Context, specs: List<AlarmSpec>) {
        val array = JSONArray()
        for (spec in specs) array.put(spec.toJson())
        context.getSharedPreferences("persistent_alarms", Context.MODE_PRIVATE)
            .edit().putString(KEY, array.toString()).apply()
    }

    /** Removes handled occurrences before a later call-end or process-recovery callback. */
    fun remove(context: Context, occurrenceId: String) {
        replace(context, all(context).filter { it.occurrenceId != occurrenceId })
    }
}
