package ca.persistent.app.alarm

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Pulls the server's on-device alarm set and re-arms it WITHOUT the WebView — the
 * heart of the autonomous background sync ([SyncWorker]). It authenticates by
 * reading the WebView's session cookie from the native [CookieManager] (the app is
 * loaded from the API origin, so its `persistent_auth` cookie is scoped there), so
 * the device stays in step with the server even when fully closed and even when
 * push is down. Alarms are computed server-side (GET /api/sync/occurrences returns
 * a ready `alarms` list); we only fill the device-local sound URI from the settings
 * the WebView last mirrored into [AlarmStore].
 *
 * Server push is thereby demoted to insurance: it can wake a resync sooner, but a
 * total push outage only staggers freshness — it never stops alarms from firing.
 */
object SyncClient {

    /** True if a sync ran to completion; false if it was skipped (no origin / not signed in). */
    @Throws(IOException::class)
    fun sync(context: Context): Boolean {
        val baseUrl = AlarmStore.apiBaseUrl(context).trimEnd('/')
        // Prefer the cookie the WebView captured for us (AlarmStore); CookieManager is
        // empty in this worker process. Fall back to a live read in case a WebView is up.
        var cookie = AlarmStore.authCookie(context)
        if (!cookie.contains("persistent_auth=")) {
            cookie = (if (baseUrl.isNotEmpty()) CookieManager.getInstance().getCookie(baseUrl) else null) ?: ""
        }
        android.util.Log.i(
            "PersistAlarm",
            "sync start baseUrl=${baseUrl.isNotEmpty()} authed=${cookie.contains("persistent_auth=")}"
        )
        if (baseUrl.isEmpty() || !cookie.contains("persistent_auth=")) return false

        // Push any actions the user took natively while the WebView wasn't running,
        // before pulling — so the server's truth already reflects them. Server acks
        // are idempotent, so racing the JS drain is harmless.
        drainPending(context, baseUrl, cookie)

        val body = httpGet("$baseUrl/api/sync/occurrences", cookie)
        if (body == null) {
            android.util.Log.i("PersistAlarm", "sync GET returned no body (auth/net failure)")
            return false
        }
        val parsed = JSONObject(body)
        val alarmsJson = parsed.optJSONArray("alarms") ?: JSONArray()
        val specs = mutableListOf<AlarmSpec>()
        for (i in 0 until alarmsJson.length()) {
            parseAlarm(context, alarmsJson.optJSONObject(i))?.let { specs.add(it) }
        }
        // The readable agenda rides the same response (see AgendaStore): the wider set
        // the car screen lists, none of it armed. Absent from an older server, which
        // simply leaves the list at what the alarm set covers.
        val agendaJson = parsed.optJSONArray("agenda") ?: JSONArray()
        val agenda = mutableListOf<AgendaEntry>()
        for (i in 0 until agendaJson.length()) {
            AgendaEntry.fromJson(agendaJson.optJSONObject(i))?.let { agenda.add(it) }
        }
        android.util.Log.i("PersistAlarm", "sync ok alarms=${specs.size} agenda=${agenda.size}")
        AlarmPlugin.scheduleAll(context, specs)
        AlarmPlugin.setAgenda(context, agenda)
        return true
    }

    /**
     * Turn a server DeviceAlarm into an AlarmSpec, filling in the tone.
     *
     * The reminder's own tone wins where it has one — the server sends it as
     * `sound`/`nagSound`, each `{uri, title}` — and this device's setting applies
     * otherwise. The title travels with an override because it may have been picked
     * on another phone; SoundResolver is what turns the pair into something playable
     * here. A device tone needs no title: it came from this device's own picker.
     */
    private fun parseAlarm(context: Context, json: JSONObject?): AlarmSpec? {
        if (json == null) return null
        val occurrenceId = json.optString("occurrenceId").ifEmpty { return null }
        if (!json.has("fireAtMs")) return null
        val soundKind = json.optString("soundKind", "notification")
        val sound = json.optJSONObject("sound")
        val nagSound = json.optJSONObject("nagSound")
        return AlarmSpec(
            occurrenceId = occurrenceId,
            fireAtMs = json.optLong("fireAtMs"),
            title = json.optString("title", "Reminder"),
            body = json.optString("body", ""),
            soundIntervalSeconds = json.optInt("soundIntervalSeconds", 0),
            alarm = json.optBoolean("alarm", false),
            ongoing = json.optBoolean("ongoing", true),
            soundUri = sound?.optString("uri") ?: AlarmStore.soundUri(context, soundKind),
            soundTitle = sound?.optString("title") ?: "",
            // Only the soft-notification path re-sounds; an alarm rings continuously,
            // which is why the server never sends a nag tone for one.
            nagSoundUri = nagSound?.optString("uri")
                ?: if (soundKind == "alarm") "" else AlarmStore.soundUri(context, "nag"),
            nagSoundTitle = nagSound?.optString("title") ?: "",
            reminderId = json.optString("reminderId", ""),
            canSilence = json.optBoolean("canSilence", false),
            shadeProminence = json.optString("shadeProminence", "INHERIT")
        )
    }

    /** POST the native ack/snooze/silence queues to the server (mirrors nativeSync.ts drains). */
    private fun drainPending(context: Context, baseUrl: String, cookie: String) {
        val ackBase = PendingAckStore.drain(context).map { it.removeSuffix(AlarmReceiver.ESC_SUFFIX) }.toSet()
        for (id in ackBase) runCatching { httpPost("$baseUrl/api/occurrences/$id/ack", cookie, null) }

        for ((rawId, minutes) in PendingSnoozeStore.drain(context)) {
            val id = rawId.removeSuffix(AlarmReceiver.ESC_SUFFIX)
            runCatching { httpPost("$baseUrl/api/occurrences/$id/snooze", cookie, JSONObject().put("minutes", minutes)) }
        }

        val silenceBase = PendingSilenceStore.drain(context).map { it.removeSuffix(AlarmReceiver.ESC_SUFFIX) }.toSet()
        for (id in silenceBase) runCatching { httpPost("$baseUrl/api/occurrences/$id/silence", cookie, null) }
    }

    @Throws(IOException::class)
    private fun httpGet(url: String, cookie: String): String? {
        val conn = open(url, cookie)
        conn.requestMethod = "GET"
        return try {
            val code = conn.responseCode
            if (code != HttpURLConnection.HTTP_OK) {
                android.util.Log.i("PersistAlarm", "sync GET http=$code")
                null
            } else {
                conn.inputStream.bufferedReader().use { it.readText() }
            }
        } finally {
            conn.disconnect()
        }
    }

    @Throws(IOException::class)
    private fun httpPost(url: String, cookie: String, body: JSONObject?) {
        val conn = open(url, cookie)
        conn.requestMethod = "POST"
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
        try {
            conn.responseCode // drive the request
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: String, cookie: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.setRequestProperty("Cookie", cookie)
        conn.setRequestProperty("Accept", "application/json")
        conn.connectTimeout = 15_000
        conn.readTimeout = 15_000
        return conn
    }
}
