package ca.persistent.app.alarm

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.car.app.connection.CarConnection

/**
 * Tracks whether the phone is currently projecting to Android Auto, and since when.
 *
 * Android Auto surfaces ONLY `MessagingStyle` notifications (carrying reply +
 * mark-as-read actions). So only while projecting does [AlarmService.buildNotification]
 * mirror a nag in that form, with invisible reply/mark-as-read actions. Off the car
 * this stays false and the heavily-tuned phone shade notification is left exactly as
 * it was — the gate keeps the car integration from perturbing normal phone behaviour.
 *
 * [projectingSince] is the second half of that gate. Projecting is not on its own a
 * reason to put a nag in front of the driver: what matters is whether the nag is
 * *happening*, which [AlarmService.mirrorsToCar] decides by comparing it against when
 * each occurrence last genuinely alerted.
 */
object CarProjection {
    @Volatile
    var projecting: Boolean = false
        private set

    /**
     * Wall-clock instant projection last began (0 while not projecting). Compared
     * against an occurrence's last genuine alert to tell a nag that is firing now from
     * one that was already on screen when the car was started.
     */
    @Volatile
    var projectingSince: Long = 0L
        private set

    private var started = false

    /**
     * Begin observing the Android Auto connection. Idempotent and safe to call from
     * any [AlarmService] start — it's the universal notification poster (foreground
     * fires, FCM-driven shows, and the background keep-alive all route through it), so
     * every process that posts a nag also arms this.
     *
     * The two directions are deliberately not symmetric:
     * - **Connecting** re-posts only the nags that qualify for the car right now
     *   ([AlarmService.mirrorLiveToCar]). Re-styling all of them — which is what this
     *   used to do — landed every live nag in the car as a brand-new message at once,
     *   so starting the car replayed the whole backlog as a burst of cards.
     * - **Disconnecting** re-posts everything ([AlarmService.restyleAll]), because every
     *   nag that did gain the car form has to lose it again and get its phone shade
     *   styling back.
     */
    fun init(context: Context) {
        if (started) return
        // Android Auto requires API 23+, and androidx.car.app is minSdk 23.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        started = true
        val appContext = context.applicationContext
        // observeForever must run on the main thread; a Service's onCreate may not be it.
        Handler(Looper.getMainLooper()).post {
            CarConnection(appContext).type.observeForever { type ->
                val next = type == CarConnection.CONNECTION_TYPE_PROJECTION
                if (next != projecting) {
                    projecting = next
                    if (next) {
                        projectingSince = System.currentTimeMillis()
                        AlarmService.mirrorLiveToCar(appContext)
                    } else {
                        projectingSince = 0L
                        AlarmService.restyleAll(appContext)
                    }
                }
            }
        }
    }
}
