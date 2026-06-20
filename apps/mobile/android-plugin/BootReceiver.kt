package ca.persistent.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-arms all stored exact alarms after a device reboot (AlarmManager alarms do
 * not survive reboot). Past-due alarms are armed in the past, so AlarmManager
 * fires them immediately — the user still gets nagged for anything they missed
 * while powered off, until the next server sync reconciles state.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        for (alarm in AlarmStore.all(context)) {
            AlarmPlugin.armAlarm(context, alarm)
        }
    }
}
