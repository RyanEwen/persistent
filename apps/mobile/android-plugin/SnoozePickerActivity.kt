package ca.persistent.app.alarm

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

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

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#111726"))
            setPadding(48, 48, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = "Snooze for…"
            textSize = 22f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 24)
        })
        for ((label, minutes) in presets) {
            root.addView(Button(this).apply {
                text = label
                setOnClickListener {
                    sendBroadcast(
                        Intent(this@SnoozePickerActivity, AlarmReceiver::class.java)
                            .setAction(AlarmReceiver.ACTION_SNOOZE)
                            .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
                            .putExtra(AlarmReceiver.EXTRA_MINUTES, minutes)
                    )
                    finish()
                }
            })
        }

        setContentView(root)
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
