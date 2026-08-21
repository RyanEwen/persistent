package ca.persistent.app.alarm

import android.app.Activity
import android.app.DatePickerDialog
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
 * can choose how long to snooze: a preset, a custom number + unit, or a specific
 * date + time (converted to minutes-from-now). The chosen minutes broadcast
 * ACTION_SNOOZE; AlarmReceiver re-arms + syncs it. Built in code to avoid shipping XML.
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

    // Claimed only while the custom view is up, so Back steps back to the presets.
    // At the presets it stays unclaimed on purpose: the system then finishes the
    // activity itself, with the predictive-back animation an interception would
    // have replaced with a jump cut. See BackInterception.
    private val back = BackInterception(this) { renderMain() }

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
        // Same edge-to-edge enforcement as AlarmActivity (API 35+).
        AlarmUi.applySystemBarInsets(scaffold.root)
        renderMain()
    }

    /**
     * Re-target the picker at whichever occurrence the new intent names.
     *
     * This activity is `singleInstance`, so a second Snooze while it is still alive
     * reuses this instance — and without this override it would keep the occurrence it
     * read in `onCreate` and snooze **the wrong reminder**, leaving the one the user
     * actually picked ringing. That went from impossible to routine when AlarmActivity
     * stopped finishing itself on the way here (it now has a queue to go back to), and
     * the shade's per-occurrence Snooze actions all target this one activity too.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val id = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
        if (id == null) {
            finish()
            return
        }
        occurrenceId = id
        // Start over at the presets: a half-entered custom duration belonged to the
        // previous reminder, and carrying it across would attach it to this one.
        renderMain()
    }

    /** The preset list plus entry points to the custom + until-a-time flows. */
    private fun renderMain() {
        showingCustom = false
        back.disable()
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
        // Snooze until a specific date + time, picked via the system date then clock.
        content.addView(AlarmUi.pillButton(this, "Until a date & time…", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
            pickDateTime()
        })
    }

    /** Chain the system date picker into the time picker, then snooze until then. */
    private fun pickDateTime() {
        val now = Calendar.getInstance()
        val datePicker = DatePickerDialog(
            this,
            { _, year, month, day ->
                TimePickerDialog(
                    this,
                    { _, hour, minute ->
                        val target = Calendar.getInstance().apply {
                            set(year, month, day, hour, minute, 0)
                            set(Calendar.MILLISECOND, 0)
                        }
                        snooze(minutesUntil(target))
                    },
                    now.get(Calendar.HOUR_OF_DAY),
                    now.get(Calendar.MINUTE),
                    DateFormat.is24HourFormat(this)
                ).show()
            },
            now.get(Calendar.YEAR),
            now.get(Calendar.MONTH),
            now.get(Calendar.DAY_OF_MONTH)
        )
        datePicker.datePicker.minDate = now.timeInMillis
        datePicker.show()
    }

    /** A dedicated view (replacing the list) for entering a custom number + unit. */
    private fun renderCustom() {
        showingCustom = true
        back.enable()
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
        // API 22 to 32 only; on API 33+ the registered callback handles it instead
        // and this is never called. `handleLegacyBack` returns false at the presets,
        // which is where Back should close the surface as usual.
        if (!back.handleLegacyBack()) @Suppress("DEPRECATION") super.onBackPressed()
    }

    /**
     * Minutes from now until [target]. Clamped to [1, MAX_SNOOZE_MINUTES] so a
     * past pick still yields a valid ACTION_SNOOZE amount and a far-future one
     * can't exceed the snooze ceiling.
     */
    private fun minutesUntil(target: Calendar): Int {
        val now = Calendar.getInstance()
        val minutes = ((target.timeInMillis - now.timeInMillis) / 60_000L).toInt()
        return minutes.coerceIn(1, MAX_SNOOZE_MINUTES)
    }

    private fun snooze(minutes: Int) {
        val id = occurrenceId ?: return
        sendBroadcast(
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_SNOOZE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, id)
                .putExtra(AlarmReceiver.EXTRA_MINUTES, minutes.coerceIn(1, MAX_SNOOZE_MINUTES))
        )
        finish()
    }

    companion object {
        // Keep in lockstep with MAX_SNOOZE_MINUTES in packages/shared (1 year).
        private const val MAX_SNOOZE_MINUTES = 525_600
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
