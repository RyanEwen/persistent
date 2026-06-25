package ca.persistent.app.alarm

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.content.ContextCompat
import ca.persistent.app.alarm.AlarmUi.addStacked

/**
 * Full-screen alarm UI launched over the lock screen by the full-screen intent.
 * Big "Done" / "Snooze" buttons; Done is the only thing that stops a PERSISTENT/
 * ALARM reminder. Built in code to avoid shipping XML resources with the plugin.
 */
class AlarmActivity : Activity() {

    private var occurrenceId: String? = null

    // Finish this surface when its occurrence is silenced/acked/snoozed/cleared from
    // anywhere else (the shade action, another device's WS event, the in-app button).
    // Without this the full-screen alarm would linger after the alarm is handled
    // elsewhere — a stale "second notification" on top of the (downgraded) shade nag.
    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val target = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
            if (target == null || target == occurrenceId) finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()

        occurrenceId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
        ContextCompat.registerReceiver(
            this,
            dismissReceiver,
            IntentFilter(ACTION_DISMISS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        val title = intent.getStringExtra("title") ?: "Reminder"
        val body = intent.getStringExtra("body") ?: ""
        val canSilence = intent.getBooleanExtra("canSilence", false)

        val scaffold = AlarmUi.scaffold(this)
        val content = scaffold.content

        content.addStacked(AlarmUi.kicker(this, "REMINDER"))
        content.addStacked(AlarmUi.title(this, title), topMarginDp = 6f)
        if (body.isNotEmpty()) {
            content.addStacked(AlarmUi.body(this, body))
        }

        content.addView(AlarmUi.pillButton(this, "Done", AlarmUi.ButtonStyle.PRIMARY, topMarginDp = 28f) {
            // The full-screen alarm is itself the deliberate surface, so Done acks
            // directly (no notification confirm round-trip, no app launch).
            sendAction(AlarmReceiver.ACTION_CONFIRM)
            finish()
        })
        content.addView(AlarmUi.pillButton(this, "Snooze…", AlarmUi.ButtonStyle.SECONDARY, topMarginDp = 12f) {
            occurrenceId?.let { id ->
                startActivity(
                    Intent(this@AlarmActivity, SnoozePickerActivity::class.java)
                        .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, id)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
            finish()
        })
        if (canSilence) {
            // Escalation only: stop the alarm but leave the reminder nagging.
            content.addView(AlarmUi.pillButton(this, "Silence", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
                sendAction(AlarmReceiver.ACTION_SILENCE)
                finish()
            })
        }

        setContentView(scaffold.root)
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { unregisterReceiver(dismissReceiver) }
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

    companion object {
        /** Internal broadcast: finish the on-screen alarm surface for an occurrence
         * (or, with no occurrence-id extra, any surface) once its alarm is handled. */
        const val ACTION_DISMISS = "ca.persistent.app.ALARM_ACTIVITY_DISMISS"
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
