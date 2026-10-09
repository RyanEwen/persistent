package ca.persistent.app.alarm

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.util.Log
import org.json.JSONObject

/** Concrete app colors persisted separately from alarms and account credentials. */
internal class AlarmPalette(private val colors: Map<String, Int>) {
    val background: Int get() = colors.getValue("background")
    val surface: Int get() = colors.getValue("surface")
    val surfacePressed: Int get() = colors.getValue("surfacePressed")
    val text: Int get() = colors.getValue("text")
    val secondary: Int get() = colors.getValue("secondary")
    val border: Int get() = colors.getValue("border")
    val accent: Int get() = colors.getValue("accent")
    val accentPressed: Int get() = colors.getValue("accentPressed")
    val onAccent: Int get() = colors.getValue("onAccent")
    val kicker: Int get() = colors.getValue("kicker")
    val done: Int get() = colors.getValue("done")
    val donePressed: Int get() = colors.getValue("donePressed")
    val onDone: Int get() = colors.getValue("onDone")
}

/** Resolve Match system at alarm time, including when the WebView is closed. */
internal object AlarmAppearance {
    const val ACTION_CHANGED = "ca.persistent.app.APPEARANCE_CHANGED"
    private const val PREFS = "persistent_appearance"
    private const val KEY = "appearance"
    private val colorKeys = listOf("background", "surface", "surfacePressed", "text", "secondary", "border", "accent", "accentPressed", "onAccent", "kicker", "done", "donePressed", "onDone")
    private val hexColor = Regex("^#[0-9a-fA-F]{6}$")

    private data class Appearance(val mode: String, val light: AlarmPalette, val dark: AlarmPalette)
    private var cachedRaw: String? = null
    private var cachedAppearance: Appearance? = null

    // First-run fallback mirrors the traditional Joy palettes until the hosted
    // app supplies its selected colors. No network is needed to show an alarm.
    private val light = AlarmPalette(mapOf(
        "background" to Color.parseColor("#f5f5f5"),
        "surface" to Color.parseColor("#ffffff"),
        "surfacePressed" to Color.parseColor("#e5e5e5"),
        "text" to Color.parseColor("#262626"),
        "secondary" to Color.parseColor("#404040"),
        "border" to Color.parseColor("#d4d4d4"),
        "accent" to Color.parseColor("#0B6BCB"),
        "accentPressed" to Color.parseColor("#185EA5"),
        "onAccent" to Color.parseColor("#FFFFFF"),
        "kicker" to Color.parseColor("#0B6BCB"),
        "done" to Color.parseColor("#1F7A1F"),
        "donePressed" to Color.parseColor("#136C13"),
        "onDone" to Color.parseColor("#FFFFFF")
    ))
    private val dark = AlarmPalette(mapOf(
        "background" to Color.parseColor("#171717"),
        "surface" to Color.parseColor("#222222"),
        "surfacePressed" to Color.parseColor("#404040"),
        "text" to Color.parseColor("#f5f5f5"),
        "secondary" to Color.parseColor("#d4d4d4"),
        "border" to Color.parseColor("#404040"),
        "accent" to Color.parseColor("#2563eb"),
        "accentPressed" to Color.parseColor("#1d4ed8"),
        "onAccent" to Color.parseColor("#FFFFFF"),
        "kicker" to Color.parseColor("#97C3F0"),
        "done" to Color.parseColor("#1F7A1F"),
        "donePressed" to Color.parseColor("#136C13"),
        "onDone" to Color.parseColor("#FFFFFF")
    ))

    private fun parsePalette(value: JSONObject): AlarmPalette = AlarmPalette(colorKeys.associateWith { key ->
        val color = value.optString(key)
        require(hexColor.matches(color)) { "Invalid appearance color: $key" }
        Color.parseColor(color)
    })

    /** Reject incomplete or unsupported bridge payloads before changing the saved preference. */
    private fun parse(value: JSONObject): Appearance {
        require(value.optInt("version") == 1) { "Unsupported appearance version" }
        val mode = value.optString("mode")
        require(mode in listOf("system", "light", "dark")) { "Invalid appearance mode" }
        return Appearance(mode, parsePalette(value.getJSONObject("light")), parsePalette(value.getJSONObject("dark")))
    }

    /** Return whether colors changed; repeated syncs must not refresh live alarms. */
    fun save(context: Context, value: JSONObject): Boolean {
        val appearance = parse(value)
        val raw = value.toString()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY, null) == raw) return false
        prefs.edit().putString(KEY, raw).apply()
        cachedRaw = raw
        cachedAppearance = appearance
        return true
    }

    /** Read the persisted selection, falling back safely if cosmetic storage is damaged. */
    fun palette(context: Context): AlarmPalette {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        if (raw != cachedRaw) {
            cachedAppearance = try {
                raw?.let { parse(JSONObject(it)) }
            } catch (error: Exception) {
                Log.w("AlarmAppearance", "Ignoring invalid saved appearance", error)
                null
            }
            cachedRaw = raw
        }
        val saved = cachedAppearance
        val darkMode = when (saved?.mode) {
            "light" -> false
            "dark" -> true
            else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        }
        return if (darkMode) saved?.dark ?: dark else saved?.light ?: light
    }

    fun isDark(context: Context): Boolean {
        val background = palette(context).background
        // The app's fixed palettes are either pale or dark. This also selects
        // readable system-bar glyphs for Forest, Plum, and Navy.
        return (Color.red(background) * 299 + Color.green(background) * 587 + Color.blue(background) * 114) < 128000
    }
}
