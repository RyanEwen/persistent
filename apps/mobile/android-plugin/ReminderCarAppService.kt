package ca.persistent.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * The Android Auto car screen: the whole on-device reminder list, readable and
 * actionable on the head unit rather than only as notifications.
 *
 * **Direct flavor only** (`setup-android.mjs`, `DIRECT_ONLY_KT` + the direct manifest).
 * A templated car app has to declare one of Android Auto's approved categories, and a
 * reminder app is none of them, so shipping this in the Play AAB would put every
 * release at risk of an Auto review rejection. The sideloaded build takes it instead —
 * the same split, and for the same reason, as `UpdatePlugin`. See
 * `store/play-readiness.md`.
 *
 * It pairs with the notification mirror rather than replacing it. Notifications are for
 * what is *happening* (see `AlarmService.mirrorsToCar`); this screen is for everything
 * else — the backlog that used to be dumped into the car all at once on connect, plus
 * what is still to come.
 *
 * The screens read [CarReminders] (the on-device alarm set) and act through the same
 * [AlarmService] companion entry points the notification actions use, so a Done from
 * the car reaches the server and re-arms locally with no separate path.
 */
class ReminderCarAppService : CarAppService() {

    /**
     * Debug builds accept any host so the Desktop Head Unit can drive the app; release
     * builds accept only the hosts the library vouches for (Android Auto, AAOS), which
     * is what stops an untrusted app on the phone from binding this service and reading
     * the user's reminders.
     */
    override fun createHostValidator(): HostValidator =
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(): Session = ReminderCarSession()
}

/** One connected-to-the-car session; the list is always the root screen. */
class ReminderCarSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = ReminderListScreen(carContext)
}

/**
 * Redraw this screen whenever the on-device reminder set actually changes — a fire, a
 * Done from the phone or another device, a de-escalation, a resync (see
 * [CarListRefresh]).
 *
 * Push, not poll: a car screen that re-read on a timer would either lag behind a
 * reminder that just fired or burn the battery pretending not to. The receiver is tied
 * to the screen's own lifecycle, so a backgrounded screen holds nothing, and re-reads
 * once on start to pick up whatever it missed while it was stopped.
 *
 * **A redraw that would change nothing is skipped**, because a car screen doesn't get
 * to push templates freely — the host meters them, and the app is expected to spend
 * them on real changes. The signal is deliberately coarse (it fires wherever the set
 * *might* have moved, e.g. once per nag the keep-alive re-asserts), so this compares
 * what would be drawn and stays quiet when the answer is the same.
 */
internal fun Screen.redrawOnReminderChanges() {
    // Everything the screens render, so any visible difference lands in the comparison.
    // Not the relative "in 25 min" phrasing, which is derived from the clock rather than
    // the data — nothing broadcasts the passage of time, and a car screen that redrew
    // for it would spend its budget on a minute ticking over.
    fun rendered(): String = CarReminders.load(carContext).joinToString("|") {
        "${it.occurrenceId}:${it.title}:${it.body}:${it.fireAtMs}:${it.due}:${it.ringing}:${it.canSilence}"
    }

    var lastRendered: String? = null
    val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val next = rendered()
            if (next == lastRendered) return
            lastRendered = next
            invalidate()
        }
    }
    lifecycle.addObserver(object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            ContextCompat.registerReceiver(
                carContext,
                receiver,
                IntentFilter(CarListRefresh.ACTION),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            // Unconditional: the set may have moved on while the screen was stopped, and
            // the template it last drew is gone anyway.
            lastRendered = rendered()
            invalidate()
        }

        override fun onStop(owner: LifecycleOwner) {
            runCatching { carContext.unregisterReceiver(receiver) }
        }
    })
}
