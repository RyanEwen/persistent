package ca.persistent.app.alarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persists the scheduled-alarm set in SharedPreferences so [BootReceiver] can
 * re-arm exact alarms after a reboot (AlarmManager alarms don't survive reboot).
 */
object AlarmStore {
    private const val PREFS = "persistent_alarms"
    private const val KEY = "alarms"
    // Device-default shade prominence for reminders set to INHERIT (visual only).
    private const val KEY_DEFAULT_MINIMIZED = "default_minimized"
    // Config the background SyncWorker needs but can't read from the WebView.
    private const val KEY_API_BASE_URL = "api_base_url"
    private const val KEY_ALARM_SOUND = "alarm_sound_uri"
    private const val KEY_NOTIFICATION_SOUND = "notification_sound_uri"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun defaultMinimized(context: Context): Boolean = prefs(context).getBoolean(KEY_DEFAULT_MINIMIZED, false)

    fun setDefaultMinimized(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_DEFAULT_MINIMIZED, value).apply()
    }

    /** The WebView mirrors these on each foreground sync (see AlarmPlugin.setSyncConfig). */
    fun setSyncConfig(context: Context, apiBaseUrl: String, alarmSoundUri: String, notificationSoundUri: String) {
        prefs(context).edit()
            .putString(KEY_API_BASE_URL, apiBaseUrl)
            .putString(KEY_ALARM_SOUND, alarmSoundUri)
            .putString(KEY_NOTIFICATION_SOUND, notificationSoundUri)
            .apply()
    }

    /** API origin the app was last loaded from, or "" if the WebView never mirrored it. */
    fun apiBaseUrl(context: Context): String = prefs(context).getString(KEY_API_BASE_URL, "") ?: ""

    /** Chosen tone URI for the given kind ("alarm"/"notification"); "" = system default. */
    fun soundUri(context: Context, kind: String): String {
        val key = if (kind == "alarm") KEY_ALARM_SOUND else KEY_NOTIFICATION_SOUND
        return prefs(context).getString(key, "") ?: ""
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

    // --- Sound de-dup ---------------------------------------------------------
    // When did each occurrence last actually play its sound (epoch ms). Used to
    // debounce a near-simultaneous second alert for the SAME occurrence — e.g. the
    // on-device alarm plus a redundant server fire/escalate push (which falls back to
    // the default tone). Durable so it survives the process being killed between the
    // two triggers. Pruned to keep it small.
    private const val KEY_SOUNDED_AT = "sounded_at"

    fun lastSoundedAt(context: Context, occurrenceId: String): Long {
        val raw = prefs(context).getString(KEY_SOUNDED_AT, "{}") ?: "{}"
        return try {
            JSONObject(raw).optLong(occurrenceId, 0L)
        } catch (_: Exception) {
            0L
        }
    }

    fun markSoundedNow(context: Context, occurrenceId: String, nowMs: Long) {
        val raw = prefs(context).getString(KEY_SOUNDED_AT, "{}") ?: "{}"
        val obj = try {
            JSONObject(raw)
        } catch (_: Exception) {
            JSONObject()
        }
        obj.put(occurrenceId, nowMs)
        // Prune entries older than an hour so the map can't grow unbounded.
        val cutoff = nowMs - 3_600_000L
        val stale = mutableListOf<String>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (obj.optLong(k) < cutoff) stale.add(k)
        }
        for (k in stale) obj.remove(k)
        prefs(context).edit().putString(KEY_SOUNDED_AT, obj.toString()).apply()
    }

    /** Forget an occurrence's last-sounded time so its next fire (or snooze re-fire) sounds. */
    fun clearSounded(context: Context, occurrenceId: String) {
        val raw = prefs(context).getString(KEY_SOUNDED_AT, "{}") ?: return
        val obj = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return
        }
        if (obj.has(occurrenceId)) {
            obj.remove(occurrenceId)
            prefs(context).edit().putString(KEY_SOUNDED_AT, obj.toString()).apply()
        }
    }
}
