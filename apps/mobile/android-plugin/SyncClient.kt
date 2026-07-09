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
        val alarmsJson = JSONObject(body).optJSONArray("alarms") ?: JSONArray()
        val specs = mutableListOf<AlarmSpec>()
        for (i in 0 until alarmsJson.length()) {
            parseAlarm(context, alarmsJson.optJSONObject(i))?.let { specs.add(it) }
        }
        android.util.Log.i("PersistAlarm", "sync ok alarms=${specs.size}")
        AlarmPlugin.scheduleAll(context, specs)
        return true
    }

    /** Turn a server DeviceAlarm into an AlarmSpec, filling the device-local sound URI. */
    private fun parseAlarm(context: Context, json: JSONObject?): AlarmSpec? {
        if (json == null) return null
        val occurrenceId = json.optString("occurrenceId").ifEmpty { return null }
        if (!json.has("fireAtMs")) return null
        val soundKind = json.optString("soundKind", "notification")
        return AlarmSpec(
            occurrenceId = occurrenceId,
            fireAtMs = json.optLong("fireAtMs"),
            title = json.optString("title", "Reminder"),
            body = json.optString("body", ""),
            soundIntervalSeconds = json.optInt("soundIntervalSeconds", 0),
            alarm = json.optBoolean("alarm", false),
            ongoing = json.optBoolean("ongoing", true),
            soundUri = AlarmStore.soundUri(context, soundKind),
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
