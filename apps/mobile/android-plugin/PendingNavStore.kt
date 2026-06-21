package ca.persistent.app.alarm

import android.content.Context

/**
 * The reminder id the user tapped on a notification, awaiting the WebView to pick
 * it up and navigate (it owns the router). Mirrors PendingAckStore but holds a
 * single most-recent value.
 */
object PendingNavStore {
    private const val PREFS = "persistent_alarms"
    private const val KEY = "pending_nav_reminder"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun set(context: Context, reminderId: String) {
        prefs(context).edit().putString(KEY, reminderId).apply()
    }

    /** Return and clear the pending reminder id, or null if none. */
    fun consume(context: Context): String? {
        val id = prefs(context).getString(KEY, null)
        if (id != null) prefs(context).edit().remove(KEY).apply()
        return id?.ifEmpty { null }
    }
}
