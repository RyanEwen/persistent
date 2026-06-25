package ca.persistent.app.alarm

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import ca.persistent.app.alarm.AlarmUi.addStacked

/**
 * Small dialog launched from a notification's "Snooze" action so the user can
 * choose how long to snooze. Picking a preset broadcasts ACTION_SNOOZE with the
 * minutes; AlarmReceiver re-arms + syncs it. Built in code to avoid shipping XML.
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        val occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
        if (occurrenceId == null) {
            finish()
            return
        }

        val scaffold = AlarmUi.scaffold(this)
        val card = scaffold.card

        card.addStacked(AlarmUi.kicker(this, "SNOOZE"))
        card.addStacked(AlarmUi.title(this, "Snooze for…"), topMarginDp = 6f)
        presets.forEachIndexed { index, (label, minutes) ->
            card.addView(
                AlarmUi.pillButton(
                    this,
                    label,
                    AlarmUi.ButtonStyle.SECONDARY,
                    topMarginDp = if (index == 0) 24f else 12f
                ) {
                    sendBroadcast(
                        Intent(this@SnoozePickerActivity, AlarmReceiver::class.java)
                            .setAction(AlarmReceiver.ACTION_SNOOZE)
                            .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
                            .putExtra(AlarmReceiver.EXTRA_MINUTES, minutes)
                    )
                    finish()
                }
            )
        }

        setContentView(scaffold.root)
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
