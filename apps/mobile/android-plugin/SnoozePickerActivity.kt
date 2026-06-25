package ca.persistent.app.alarm

import android.app.Activity
import android.app.TimePickerDialog
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.view.WindowManager
import android.widget.LinearLayout
import ca.persistent.app.alarm.AlarmUi.addStacked
import java.util.Calendar

/**
 * Full-screen surface launched from a notification's "Snooze" action so the user
 * can choose how long to snooze: a preset, a custom number + unit, or a wall-clock
 * time (converted to minutes-from-now). The chosen minutes broadcast ACTION_SNOOZE;
 * AlarmReceiver re-arms + syncs it. Built in code to avoid shipping XML.
 *
 * Two views swap in place on the same scaffold: the preset list, and a dedicated
 * "custom" entry view (so Custom doesn't just grow the already-long list). Back
 * returns to the list before it leaves the surface.
 */
class SnoozePickerActivity : Activity() {

    // label -> minutes
    private val presets = listOf(
        "5 minutes" to 5,
        "10 minutes" to 10,
        "15 minutes" to 15,
        "30 minutes" to 30,
        "1 hour" to 60,
        "3 hours" to 180,
        "1 day" to 1440
    )

    // Units for the custom view, mirroring the in-app picker (minutes-per-unit).
    private val customUnits = listOf("min" to 1, "hr" to 60, "day" to 1440)

    private lateinit var content: LinearLayout
    private var occurrenceId: String? = null
    private var showingCustom = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
        if (occurrenceId == null) {
            finish()
            return
        }

        val scaffold = AlarmUi.scaffold(this)
        content = scaffold.content
        setContentView(scaffold.root)
        renderMain()
    }

    /** The preset list plus entry points to the custom + until-a-time flows. */
    private fun renderMain() {
        showingCustom = false
        content.removeAllViews()
        content.addStacked(AlarmUi.kicker(this, "SNOOZE"))
        content.addStacked(AlarmUi.title(this, "Snooze for…"), topMarginDp = 6f)
        presets.forEachIndexed { index, (label, minutes) ->
            content.addView(
                AlarmUi.pillButton(
                    this,
                    label,
                    AlarmUi.ButtonStyle.SECONDARY,
                    topMarginDp = if (index == 0) 24f else 12f
                ) { snooze(minutes) }
            )
        }
        content.addView(AlarmUi.pillButton(this, "Custom…", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
            renderCustom()
        })
        // Snooze until a specific wall-clock time, picked via the system clock.
        content.addView(AlarmUi.pillButton(this, "Until a time…", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
            val now = Calendar.getInstance()
            TimePickerDialog(
                this,
                { _, hour, minute -> snooze(minutesUntil(hour, minute)) },
                now.get(Calendar.HOUR_OF_DAY),
                now.get(Calendar.MINUTE),
                DateFormat.is24HourFormat(this)
            ).show()
        })
    }

    /** A dedicated view (replacing the list) for entering a custom number + unit. */
    private fun renderCustom() {
        showingCustom = true
        content.removeAllViews()
        var unitMinutes = customUnits[0].second
        val field = AlarmUi.numberField(this, "45", topMarginDp = 0f)
        content.addStacked(AlarmUi.kicker(this, "SNOOZE"))
        content.addStacked(AlarmUi.title(this, "Custom snooze"), topMarginDp = 6f)
        content.addView(field, AlarmUi.stacked(this, 24f))
        content.addView(AlarmUi.segmented(this, customUnits.map { it.first }, 0, 12f) { index ->
            unitMinutes = customUnits[index].second
        })
        content.addView(AlarmUi.pillButton(this, "Snooze", AlarmUi.ButtonStyle.PRIMARY, topMarginDp = 12f) {
            val amount = field.text.toString().toIntOrNull() ?: 1
            snooze(maxOf(1, amount * unitMinutes))
        })
        content.addView(AlarmUi.pillButton(this, "Back", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
            renderMain()
        })
    }

    @Deprecated("Back steps out of the custom view to the list before leaving the surface.")
    override fun onBackPressed() {
        if (showingCustom) renderMain() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    /**
     * Minutes from now until the next occurrence of [hour]:[minute]; rolls to
     * tomorrow if that time already passed today. Clamped to the snooze ceiling
     * (1 day) so the result is always a valid ACTION_SNOOZE amount.
     */
    private fun minutesUntil(hour: Int, minute: Int): Int {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (!target.after(now)) target.add(Calendar.DAY_OF_MONTH, 1)
        val minutes = ((target.timeInMillis - now.timeInMillis) / 60_000L).toInt()
        return minutes.coerceIn(1, 1440)
    }

    private fun snooze(minutes: Int) {
        val id = occurrenceId ?: return
        sendBroadcast(
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_SNOOZE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, id)
                .putExtra(AlarmReceiver.EXTRA_MINUTES, minutes)
        )
        finish()
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
    }
}
