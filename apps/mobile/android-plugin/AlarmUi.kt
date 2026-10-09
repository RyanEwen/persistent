package ca.persistent.app.alarm

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Shared visual language for the over-the-lock-screen alarm surfaces
 * (AlarmActivity, SnoozePickerActivity). Built in code — the alarm plugin
 * deliberately ships no XML resources — so this centralizes the palette, dp
 * scaling, and pill-button styling both screens use. Tweak the look here, not in
 * each activity, so the two surfaces stay consistent.
 *
 * Colors come from the app palette saved by AlarmPlugin. Match system resolves
 * at display time without needing the WebView or a network connection. Existing
 * views update in place so an appearance change cannot reset a snooze draft.
 */
internal object AlarmUi {
    private class StyleUpdate(val apply: (AlarmPalette) -> Unit)

    /** Apply a style now and retain its updater on the view for later theme changes. */
    private fun applyAppearance(view: View, update: (AlarmPalette) -> Unit) {
        view.tag = StyleUpdate(update)
        update(AlarmAppearance.palette(view.context))
    }

    /** Restyle the existing tree, preserving text, selection, listeners, and confirmation state. */
    fun refresh(activity: android.app.Activity, root: View) {
        val palette = AlarmAppearance.palette(activity)
        fun refreshView(view: View) {
            (view.tag as? StyleUpdate)?.apply?.invoke(palette)
            if (view is ViewGroup) {
                for (index in 0 until view.childCount) refreshView(view.getChildAt(index))
            }
        }
        refreshView(root)
        val controller = androidx.core.view.WindowCompat.getInsetsController(activity.window, root)
        controller.isAppearanceLightStatusBars = !AlarmAppearance.isDark(activity)
        controller.isAppearanceLightNavigationBars = !AlarmAppearance.isDark(activity)
    }

    /** Attach theme updates only while the Activity's root is on screen. */
    fun observe(activity: android.app.Activity, root: View) {
        root.addOnAttachStateChangeListener(AlarmAppearanceObserver(activity, root))
    }

    /** Platform date/time controls follow the app's resolved light/dark appearance. */
    fun pickerTheme(context: Context): Int = if (AlarmAppearance.isDark(context)) {
        android.R.style.Theme_Material_Dialog_Alert
    } else {
        android.R.style.Theme_Material_Light_Dialog_Alert
    }

    /** The screen uses the same base color as the app without a separate navy gradient. */
    fun styleBackground(view: View) {
        applyAppearance(view) { palette -> view.setBackgroundColor(palette.background) }
    }

    fun dp(context: Context, value: Float): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics
        ).toInt()

    /**
     * Root scaffold shared by both surfaces: a full-screen background that fills
     * the whole display and scrolls if content is tall, with the caller's
     * content centered on top. Returns the content holder (a vertical
     * LinearLayout) to add children to, plus the [root] to pass to setContentView.
     */
    class Scaffold(val root: ScrollView, val content: LinearLayout)

    /**
     * Inset [view] by the system bars (status bar, nav bar, display cutout).
     *
     * Android 15 (API 35) enforces edge-to-edge for apps targeting 35: the system
     * stops insetting the window, so without this the alarm's title and its
     * Done/Snooze buttons draw *under* the status and navigation bars — on the one
     * surface where a mis-tap matters most.
     *
     * The view's padding at call time is treated as the baseline and the insets are
     * added to it, so this is safe to call once per view and independent of whatever
     * padding the scaffold already set.
     */
    fun applySystemBarInsets(view: View) {
        val base = intArrayOf(view.paddingLeft, view.paddingTop, view.paddingRight, view.paddingBottom)
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(
                base[0] + bars.left,
                base[1] + bars.top,
                base[2] + bars.right,
                base[3] + bars.bottom
            )
            windowInsets
        }
        ViewCompat.requestApplyInsets(view)
    }

    fun scaffold(context: Context): Scaffold {
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val side = dp(context, 28f)
            setPadding(side, dp(context, 48f), side, dp(context, 48f))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        val root = ScrollView(context).apply {
            isFillViewport = true
            styleBackground(this)
            addView(content)
        }
        return Scaffold(root, content)
    }

    /** Small letter-spaced label that sits above the title (e.g. "REMINDER"). */
    fun kicker(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            textSize = 13f
            applyAppearance(this) { setTextColor(it.kicker) }
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.18f
            gravity = Gravity.CENTER
        }

    fun title(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            textSize = 27f
            applyAppearance(this) { setTextColor(it.text) }
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(context, 10f), 0, 0)
        }

    fun body(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            textSize = 16f
            applyAppearance(this) { setTextColor(it.secondary) }
            gravity = Gravity.CENTER
            setLineSpacing(dp(context, 3f).toFloat(), 1f)
            setPadding(0, dp(context, 12f), 0, 0)
        }

    enum class ButtonStyle { PRIMARY, DONE, SECONDARY, GHOST }

    /** Rounded pill background with a pressed state, shared by buttons + segments. */
    private fun pillSelector(context: Context, fill: Int, pressed: Int, stroke: Int?): StateListDrawable {
        val radius = dp(context, 16f).toFloat()
        fun face(color: Int) = GradientDrawable().apply {
            cornerRadius = radius
            setColor(color)
            stroke?.let { setStroke(dp(context, 1f), it) }
        }
        return StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), face(pressed))
            addState(intArrayOf(), face(fill))
        }
    }

    /**
     * A rounded full-width pill button. DONE = semantic success, PRIMARY = app accent,
     * SECONDARY = filled surface, GHOST = outlined/transparent.
     */
    fun pillButton(
        context: Context,
        label: String,
        style: ButtonStyle,
        topMarginDp: Float,
        onClick: () -> Unit
    ): TextView {
        // A styled TextView (not Button) so no platform theme bleeds into the
        // pill — Button injects its own background/elevation/caps that fight the
        // GradientDrawable. This keeps the look identical across OEM skins.
        return TextView(context).apply {
            text = label
            isClickable = true
            isFocusable = true
            gravity = Gravity.CENTER
            textSize = 17f
            applyAppearance(this) { palette ->
                val fill: Int
                val pressed: Int
                val textColor: Int
                var stroke: Int? = null
                when (style) {
                    ButtonStyle.PRIMARY -> { fill = palette.accent; pressed = palette.accentPressed; textColor = palette.onAccent }
                    ButtonStyle.DONE -> { fill = palette.done; pressed = palette.donePressed; textColor = palette.onDone }
                    ButtonStyle.SECONDARY -> { fill = palette.surface; pressed = palette.surfacePressed; textColor = palette.text }
                    ButtonStyle.GHOST -> { fill = Color.TRANSPARENT; pressed = palette.surface; textColor = palette.secondary; stroke = palette.border }
                }
                setTextColor(textColor)
                background = pillSelector(context, fill, pressed, stroke)
            }
            typeface = Typeface.DEFAULT_BOLD
            val vpad = dp(context, 16f)
            setPadding(dp(context, 20f), vpad, dp(context, 20f), vpad)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(context, topMarginDp) }
            setOnClickListener { onClick() }
        }
    }

    /**
     * A numeric input styled as a theme-colored pill, the value side of the custom
     * duration row. Starts with [initial] selected so the first keystroke
     * replaces it.
     */
    fun numberField(context: Context, initial: String, topMarginDp: Float): EditText =
        EditText(context).apply {
            setText(initial)
            inputType = InputType.TYPE_CLASS_NUMBER
            textSize = 18f
            applyAppearance(this) { palette ->
                setTextColor(palette.text)
                setHintTextColor(palette.secondary)
                background = GradientDrawable().apply {
                    cornerRadius = dp(context, 16f).toFloat()
                    setColor(palette.surface)
                    setStroke(dp(context, 1f), palette.border)
                }
            }
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
            val vpad = dp(context, 12f)
            setPadding(dp(context, 16f), vpad, dp(context, 16f), vpad)
            setSelection(text.length)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(context, topMarginDp) }
        }

    /**
     * A horizontal segmented control of equal-width pills (e.g. unit chips for
     * the custom snooze). The selected segment uses the accent; the rest use the surface color.
     * [onSelect] fires with the chosen index; the highlight updates in place.
     */
    fun segmented(
        context: Context,
        labels: List<String>,
        initial: Int,
        topMarginDp: Float,
        onSelect: (Int) -> Unit
    ): LinearLayout {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(context, topMarginDp) }
        }
        val segments = mutableListOf<TextView>()
        fun applyStyle(view: TextView, selected: Boolean) {
            applyAppearance(view) { palette ->
                if (selected) {
                    view.background = pillSelector(context, palette.accent, palette.accentPressed, null)
                    view.setTextColor(palette.onAccent)
                } else {
                    view.background = pillSelector(context, palette.surface, palette.surfacePressed, palette.border)
                    view.setTextColor(palette.text)
                }
            }
        }
        labels.forEachIndexed { index, label ->
            val segment = TextView(context).apply {
                text = label
                isClickable = true
                isFocusable = true
                gravity = Gravity.CENTER
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                val vpad = dp(context, 13f)
                setPadding(dp(context, 8f), vpad, dp(context, 8f), vpad)
                layoutParams = LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f
                ).apply { if (index > 0) marginStart = dp(context, 8f) }
                setOnClickListener {
                    segments.forEachIndexed { i, s -> applyStyle(s, i == index) }
                    onSelect(index)
                }
            }
            segments.add(segment)
            row.addView(segment)
        }
        segments.forEachIndexed { i, s -> applyStyle(s, i == initial) }
        return row
    }

    /**
     * A row of dots saying how many alarms are ringing and which one is on screen.
     *
     * Paired with the kicker's "REMINDER 2 OF 3": the words are the precise answer and
     * the dots are the glanceable one, which matters on a surface someone is reading
     * half-awake. Returns an empty (zero-height) row for a single alarm — one dot is
     * not information, and the common case should look exactly as it did before.
     */
    fun pageDots(context: Context, count: Int, selected: Int): LinearLayout =
        LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            if (count < 2) return@apply
            val size = dp(context, 7f)
            val gap = dp(context, 6f)
            repeat(count) { index ->
                addView(View(context).apply {
                    applyAppearance(this) { palette ->
                        background = GradientDrawable().apply {
                            shape = GradientDrawable.OVAL
                            setColor(if (index == selected) palette.kicker else palette.border)
                        }
                    }
                    layoutParams = LinearLayout.LayoutParams(size, size).apply {
                        if (index > 0) marginStart = gap
                    }
                })
            }
        }

    /** Layout params for a non-button child stacked with a top margin. */
    fun stacked(context: Context, topMarginDp: Float): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(context, topMarginDp) }

    /** Add a child to a parent with [stacked] params in one call. */
    fun LinearLayout.addStacked(child: View, topMarginDp: Float = 0f) {
        addView(child, stacked(context, topMarginDp))
    }
}
