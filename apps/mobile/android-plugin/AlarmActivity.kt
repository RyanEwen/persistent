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
 * Full-screen alarm UI launched over the lock screen by the full-screen intent.
 * Big "Done" / "Snooze" buttons; Done is the only thing that stops a PERSISTENT/
 * ALARM reminder. Built in code to avoid shipping XML resources with the plugin.
 */
class AlarmActivity : Activity() {

    private var occurrenceId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()

        occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
        val title = intent.getStringExtra("title") ?: "Reminder"
        val body = intent.getStringExtra("body") ?: ""
        val canSilence = intent.getBooleanExtra("canSilence", false)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0b0f19"))
            setPadding(48, 48, 48, 48)
        }

        root.addView(TextView(this).apply {
            text = title
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        if (body.isNotEmpty()) {
            root.addView(TextView(this).apply {
                text = body
                textSize = 18f
                setTextColor(Color.parseColor("#9aa4b2"))
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 48)
            })
        }

        root.addView(Button(this).apply {
            text = "Done"
            setOnClickListener {
                // The full-screen alarm is itself the deliberate surface, so Done acks
                // directly (no notification confirm round-trip, no app launch).
                sendAction(AlarmReceiver.ACTION_CONFIRM)
                finish()
            }
        })
        root.addView(Button(this).apply {
            text = "Snooze…"
            setOnClickListener {
                occurrenceId?.let { id ->
                    startActivity(
                        Intent(this@AlarmActivity, SnoozePickerActivity::class.java)
                            .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, id)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
                finish()
            }
        })
        if (canSilence) {
            // Escalation only: stop the alarm but leave the reminder nagging.
            root.addView(Button(this).apply {
                text = "Silence"
                setOnClickListener {
                    sendAction(AlarmReceiver.ACTION_SILENCE)
                    finish()
                }
            })
        }

        setContentView(root)
    }

    @Deprecated("Back is intentionally inert so a ringing alarm's surface stays up; exit via Done/Snooze.")
    override fun onBackPressed() {
        // Match the system clock's alarm: Back does not dismiss a ringing alarm.
        // Done and Snooze are the only ways out (Home still leaves it ringing, with
        // the ongoing notification whose tap reopens this surface).
    }

    private fun sendAction(action: String) {
        val id = occurrenceId ?: return
        sendBroadcast(
            Intent(this, AlarmReceiver::class.java)
                .setAction(action)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, id)
        )
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }
}
