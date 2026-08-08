package ca.persistent.app.alarm

import android.content.Context
import android.content.Intent

/**
 * The "the on-device reminder set changed" signal the Android Auto car screen redraws
 * on (`ReminderCarAppService`, direct flavor only).
 *
 * The broadcast is fired from shared code because that's where the changes happen — a
 * fire, an ack, a de-escalation, a resync. The listener only exists in the flavor that
 * ships the car screen, so in the `play` build this is a send with nobody home, which
 * is exactly the intent: the sender must not have to know whether a car screen was
 * compiled in.
 *
 * Package-scoped ([Intent.setPackage]) and received only by a runtime-registered
 * receiver — nothing outside the app can see it or send it.
 */
object CarListRefresh {
    const val ACTION = "ca.persistent.app.CAR_LIST_CHANGED"

    fun notifyChanged(context: Context) {
        context.sendBroadcast(Intent(ACTION).setPackage(context.packageName))
    }
}
