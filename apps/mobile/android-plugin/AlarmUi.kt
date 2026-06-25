package ca.persistent.app.alarm

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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
 * Palette: teal accent on deep slate, mirroring the web app's default theme.
 */
internal object AlarmUi {
    val BG_TOP = Color.parseColor("#0B0F19")
    val BG_BOTTOM = Color.parseColor("#0D1326")
    val CARD = Color.parseColor("#161D2E")
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
     * Root scaffold shared by both surfaces: a full-screen gradient that scrolls
     * if content is tall, with a centered rounded "sheet" card the caller fills.
     * Returns the card (a vertical LinearLayout) to add children to; call
     * [mount] with the returned root to set it as the content view.
     */
    class Scaffold(val root: ScrollView, val card: LinearLayout)

    fun scaffold(context: Context): Scaffold {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = GradientDrawable().apply {
                cornerRadius = dp(context, 28f).toFloat()
                setColor(CARD)
                setStroke(dp(context, 1f), BORDER)
            }
            val pad = dp(context, 28f)
            setPadding(pad, dp(context, 32f), pad, dp(context, 32f))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        val holder = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val side = dp(context, 24f)
            setPadding(side, side, side, side)
            addView(card)
        }
        val root = ScrollView(context).apply {
            isFillViewport = true
            background = screenBackground()
            addView(
                holder,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        }
        return Scaffold(root, card)
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
        val radius = dp(context, 16f).toFloat()
        fun face(color: Int) = GradientDrawable().apply {
            cornerRadius = radius
            setColor(color)
            stroke?.let { setStroke(dp(context, 1f), it) }
        }
        val selector = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), face(pressed))
            addState(intArrayOf(), face(fill))
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
            background = selector
            val vpad = dp(context, 16f)
            setPadding(dp(context, 20f), vpad, dp(context, 20f), vpad)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(context, topMarginDp) }
            setOnClickListener { onClick() }
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
