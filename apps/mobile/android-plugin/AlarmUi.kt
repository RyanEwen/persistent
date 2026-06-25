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

/**
 * Shared visual language for the over-the-lock-screen alarm surfaces
 * (AlarmActivity, SnoozePickerActivity). Built in code — the alarm plugin
 * deliberately ships no XML resources — so this centralizes the palette, dp
 * scaling, and pill-button styling both screens use. Tweak the look here, not in
 * each activity, so the two surfaces stay consistent.
 *
 * Palette: teal accent on deep slate, mirroring the web app's default theme. The
 * background gradient fills the whole screen; content centers on top of it (no
 * floating card).
 */
internal object AlarmUi {
    val BG_TOP = Color.parseColor("#0B0F19")
    val BG_BOTTOM = Color.parseColor("#0D1326")
    val TITLE = Color.parseColor("#F5F7FA")
    val BODY = Color.parseColor("#9AA4B2")
    val KICKER = Color.parseColor("#5BE3BE")
    val ACCENT = Color.parseColor("#12B886")
    val ACCENT_PRESSED = Color.parseColor("#0CA678")
    val ON_ACCENT = Color.parseColor("#04231A")
    val SURFACE = Color.parseColor("#1E2740")
    val SURFACE_PRESSED = Color.parseColor("#273253")
    val ON_SURFACE = Color.parseColor("#E5E9F0")
    val BORDER = Color.parseColor("#2A3550")

    fun dp(context: Context, value: Float): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics
        ).toInt()

    /** Full-bleed vertical gradient applied to an activity's root view. */
    fun screenBackground(): GradientDrawable =
        GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(BG_TOP, BG_BOTTOM)
        )

    /**
     * Root scaffold shared by both surfaces: a full-screen gradient that fills
     * the whole display and scrolls if content is tall, with the caller's
     * content centered on top. Returns the content holder (a vertical
     * LinearLayout) to add children to, plus the [root] to pass to setContentView.
     */
    class Scaffold(val root: ScrollView, val content: LinearLayout)

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
            background = screenBackground()
            addView(content)
        }
        return Scaffold(root, content)
    }

    /** Small letter-spaced label that sits above the title (e.g. "REMINDER"). */
    fun kicker(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            textSize = 13f
            setTextColor(KICKER)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.18f
            gravity = Gravity.CENTER
        }

    fun title(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            textSize = 27f
            setTextColor(TITLE)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(context, 10f), 0, 0)
        }

    fun body(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            textSize = 16f
            setTextColor(BODY)
            gravity = Gravity.CENTER
            setLineSpacing(dp(context, 3f).toFloat(), 1f)
            setPadding(0, dp(context, 12f), 0, 0)
        }

    enum class ButtonStyle { PRIMARY, SECONDARY, GHOST }

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
     * A rounded full-width pill button. PRIMARY = solid teal (the affirmative
     * action), SECONDARY = filled slate surface, GHOST = outlined/transparent.
     */
    fun pillButton(
        context: Context,
        label: String,
        style: ButtonStyle,
        topMarginDp: Float,
        onClick: () -> Unit
    ): TextView {
        val fill: Int
        val pressed: Int
        val textColor: Int
        var stroke: Int? = null
        when (style) {
            ButtonStyle.PRIMARY -> { fill = ACCENT; pressed = ACCENT_PRESSED; textColor = ON_ACCENT }
            ButtonStyle.SECONDARY -> { fill = SURFACE; pressed = SURFACE_PRESSED; textColor = ON_SURFACE }
            ButtonStyle.GHOST -> { fill = Color.TRANSPARENT; pressed = SURFACE; textColor = BODY; stroke = BORDER }
        }
        // A styled TextView (not Button) so no platform theme bleeds into the
        // pill — Button injects its own background/elevation/caps that fight the
        // GradientDrawable. This keeps the look identical across OEM skins.
        return TextView(context).apply {
            text = label
            isClickable = true
            isFocusable = true
            gravity = Gravity.CENTER
            textSize = 17f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
            background = pillSelector(context, fill, pressed, stroke)
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
     * A numeric input styled as a slate pill — the value side of the custom
     * duration row. Starts with [initial] selected so the first keystroke
     * replaces it.
     */
    fun numberField(context: Context, initial: String, topMarginDp: Float): EditText =
        EditText(context).apply {
            setText(initial)
            inputType = InputType.TYPE_CLASS_NUMBER
            textSize = 18f
            setTextColor(ON_SURFACE)
            setHintTextColor(BODY)
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                cornerRadius = dp(context, 16f).toFloat()
                setColor(SURFACE)
                setStroke(dp(context, 1f), BORDER)
            }
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
     * the custom snooze). The selected segment is teal; the rest are slate.
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
            if (selected) {
                view.background = pillSelector(context, ACCENT, ACCENT_PRESSED, null)
                view.setTextColor(ON_ACCENT)
            } else {
                view.background = pillSelector(context, SURFACE, SURFACE_PRESSED, BORDER)
                view.setTextColor(ON_SURFACE)
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
