package ca.persistent.app.alarm

import android.content.Context
import android.media.RingtoneManager
import android.net.Uri
import android.util.Log

/**
 * Turn a chosen tone into a URI this device can actually play.
 *
 * This exists because a tone can now be chosen for a *reminder* rather than for a
 * device, and a reminder syncs. The URI it carries was returned by the ringtone
 * picker on whichever phone the user set it from: `content://media/...` ids are
 * assigned per device, and a file picked on one is simply absent on another. So the
 * URI is a first guess, not an answer.
 *
 * The rule the whole chain serves: **an alarm must never fail to a silence.** Losing
 * a chosen tone is a cosmetic disappointment; losing the sound is the persistence
 * guarantee failing quietly, which is the one outcome this app must not produce.
 * Hence four steps, each strictly more likely to work than the last:
 *
 *  1. the URI, if this device can open it;
 *  2. a tone with the same **title** in the device's own ringtone banks — which is
 *     what makes a stock tone ("Argon", "Oxygen") survive the trip between phones;
 *  3. the device's own chosen tone for this kind (`AlarmStore`), i.e. what the
 *     reminder was overriding;
 *  4. the system default for the kind, which is always present.
 *
 * Every fallback is logged under `PersistAlarm`, because before this the failure was
 * completely invisible: an unreadable URI threw inside `MediaPlayer.setDataSource`,
 * the exception was swallowed, and the alarm rang with no sound and no trace.
 */
object SoundResolver {

    private const val TAG = "PersistAlarm"

    /**
     * @param uri the chosen URI ("" = nothing chosen, use the device/system default)
     * @param title the title it was picked under ("" when picked on this device, where
     *   the URI is authoritative and a title lookup would only add noise)
     * @param kind AlarmStore's tone kind: "alarm", "nag", or anything else = notification
     * @param defaultType the RingtoneManager.TYPE_* backing steps 2 and 4
     */
    fun resolve(context: Context, uri: String, title: String, kind: String, defaultType: Int): Uri {
        if (uri.isNotEmpty()) {
            if (canOpen(context, uri)) return Uri.parse(uri)
            Log.w(TAG, "sound uri not readable here, falling back: $uri (title='$title')")

            // The title is a fallback *for* a URI, never a locator on its own. An empty
            // URI has always meant "nothing chosen here", and searching on a title then
            // would let a reminder that chose nothing outrank the device's own tone.
            if (title.isNotEmpty()) {
                val byTitle = findByTitle(context, title, defaultType)
                if (byTitle != null) {
                    Log.i(TAG, "resolved sound by title '$title' -> $byTitle")
                    return byTitle
                }
            }
        }

        // What the reminder was overriding. Only worth trying when the caller was
        // resolving an override in the first place — otherwise this IS the device
        // tone, and it just failed to open.
        val deviceUri = AlarmStore.soundUri(context, kind)
        if (deviceUri.isNotEmpty() && deviceUri != uri && canOpen(context, deviceUri)) {
            Log.i(TAG, "falling back to this device's $kind tone")
            return Uri.parse(deviceUri)
        }

        Log.i(TAG, "falling back to the system default tone (type=$defaultType)")
        return RingtoneManager.getDefaultUri(defaultType)
    }

    /**
     * Can this process actually read the tone? Asked by opening it, because that is
     * the same thing MediaPlayer is about to do — a URI can be well-formed, and its
     * provider present, and the read still be refused (no persisted grant) or the
     * media gone. Nothing is taken from the descriptor; opening it is the test.
     */
    private fun canOpen(context: Context, uri: String): Boolean = try {
        context.contentResolver.openAssetFileDescriptor(Uri.parse(uri), "r")?.use { true } ?: false
    } catch (_: Exception) {
        false
    }

    /**
     * Find a tone by the name it was picked under. Stock tones share titles across
     * devices of the same vintage far more reliably than they share media ids, so
     * this is what carries a reminder's chosen tone from one phone to another.
     *
     * Searched widest-first (`TYPE_ALL`) rather than only in `defaultType`'s bank: a
     * user may well pick a ringtone as an alarm tone, and a title that matches
     * something the device owns is a better answer than the system default.
     */
    private fun findByTitle(context: Context, title: String, defaultType: Int): Uri? = try {
        val manager = RingtoneManager(context)
        manager.setType(RingtoneManager.TYPE_ALL)
        val cursor = manager.cursor
        var found: Uri? = null
        var fallback: Uri? = null
        var index = 0
        while (cursor.moveToNext()) {
            val candidate = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX)
            if (candidate.equals(title, ignoreCase = true)) {
                val uri = manager.getRingtoneUri(index)
                // Prefer a match in the bank this tone is for; take any match otherwise.
                if (isOfType(context, uri, defaultType)) {
                    found = uri
                    break
                }
                if (fallback == null) fallback = uri
            }
            index++
        }
        found ?: fallback
    } catch (e: Exception) {
        Log.w(TAG, "ringtone title lookup failed for '$title'", e)
        null
    }

    private fun isOfType(context: Context, uri: Uri?, defaultType: Int): Boolean {
        if (uri == null) return false
        return try {
            RingtoneManager.getDefaultType(uri) == defaultType ||
                RingtoneManager(context).let { it.setType(defaultType); it.getRingtonePosition(uri) >= 0 }
        } catch (_: Exception) {
            false
        }
    }
}
