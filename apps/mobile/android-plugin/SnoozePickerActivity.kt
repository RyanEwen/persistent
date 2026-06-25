package ca.persistent.app.alarm

import android.app.Activity
import android.app.TimePickerDialog
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import ca.persistent.app.alarm.AlarmUi.addStacked
import java.util.Calendar

/**
 * Small dialog launched from a notification's "Snooze" action so the user can
 * choose how long to snooze. Picking a preset, a custom number + unit, or a
 * wall-clock time (converted to minutes-from-now) broadcasts ACTION_SNOOZE with
 * the minutes; AlarmReceiver re-arms + syncs it. Built in code to avoid shipping XML.
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

    // Units for the custom row, mirroring the in-app picker (minutes-per-unit).
    private val customUnits = listOf("min" to 1, "hr" to 60, "day" to 1440)
    private var customUnitMinutes = 1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
        if (occurrenceId == null) {
            finish()
            return
        }

        val scaffold = AlarmUi.scaffold(this)
        val content = scaffold.content

        content.addStacked(AlarmUi.kicker(this, "SNOOZE"))
        content.addStacked(AlarmUi.title(this, "Snooze for…"), topMarginDp = 6f)
        presets.forEachIndexed { index, (label, minutes) ->
            content.addView(
                AlarmUi.pillButton(
                    this,
                    label,
                    AlarmUi.ButtonStyle.SECONDARY,
                    topMarginDp = if (index == 0) 24f else 12f
                ) { snooze(occurrenceId, minutes) }
            )
        }

        // Custom number + unit, revealed by the "Custom…" toggle (like in-app).
        val field = AlarmUi.numberField(this, "45", topMarginDp = 0f)
        val customSection = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            layoutParams = AlarmUi.stacked(this@SnoozePickerActivity, 12f)
            addView(field)
            addView(AlarmUi.segmented(this@SnoozePickerActivity, customUnits.map { it.first }, 0, 12f) { index ->
                customUnitMinutes = customUnits[index].second
            })
            addView(AlarmUi.pillButton(this@SnoozePickerActivity, "Snooze", AlarmUi.ButtonStyle.PRIMARY, 12f) {
                val amount = field.text.toString().toIntOrNull() ?: 1
                snooze(occurrenceId, maxOf(1, amount * customUnitMinutes))
            })
        }
        content.addView(AlarmUi.pillButton(this, "Custom…", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
            customSection.visibility =
                if (customSection.visibility == View.GONE) View.VISIBLE else View.GONE
        })
        content.addView(customSection)

        // Snooze until a specific wall-clock time, picked via the system clock.
        content.addView(AlarmUi.pillButton(this, "Until a time…", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
            val now = Calendar.getInstance()
            TimePickerDialog(
                this,
                { _, hour, minute -> snooze(occurrenceId, minutesUntil(hour, minute)) },
                now.get(Calendar.HOUR_OF_DAY),
                now.get(Calendar.MINUTE),
                DateFormat.is24HourFormat(this)
            ).show()
        })

        setContentView(scaffold.root)
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

    private fun snooze(occurrenceId: String, minutes: Int) {
        sendBroadcast(
            Intent(this, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_SNOOZE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
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
