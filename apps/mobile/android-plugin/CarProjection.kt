package ca.persistent.app.alarm

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.car.app.connection.CarConnection

/**
 * Tracks whether the phone is currently projecting to Android Auto.
 *
 * Android Auto surfaces ONLY `MessagingStyle` notifications (carrying reply +
 * mark-as-read actions). So only while projecting does [AlarmService.buildNotification]
 * mirror a nag in that form, with invisible reply/mark-as-read actions. Off the car
 * this stays false and the heavily-tuned phone shade notification is left exactly as
 * it was — the gate keeps the car integration from perturbing normal phone behaviour.
 */
object CarProjection {
    @Volatile
    var projecting: Boolean = false
        private set

    private var started = false

    /**
     * Begin observing the Android Auto connection. Idempotent and safe to call from
     * any [AlarmService] start — it's the universal notification poster (foreground
     * fires, FCM-driven shows, and the background keep-alive all route through it), so
     * every process that posts a nag also arms this. When the projection state flips,
     * re-post live nags so they gain/lose their car form immediately.
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
                    AlarmService.restyleAll(appContext)
                }
            }
        }
    }
}
