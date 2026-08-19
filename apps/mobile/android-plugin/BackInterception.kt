package ca.persistent.app.alarm

import android.app.Activity
import android.os.Build
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi

/**
 * Intercepting Back on a plain `android.app.Activity`, on both of Android's back
 * mechanisms.
 *
 * Android has two. The old one delivers `KEYCODE_BACK` and calls `onBackPressed()`.
 * The new one (API 33+) hands the gesture to callbacks registered with
 * `OnBackInvokedDispatcher`, and it is what drives the predictive-back animation.
 * An activity gets one or the other, never both: opting in to predictive back stops
 * `onBackPressed()` and `KEYCODE_BACK` arriving at all. That is the trap this class
 * exists to close, because the opt-in is *implicit* at `targetSdk 36` and silent, so
 * an untouched `onBackPressed` override simply stops running.
 *
 * `MainActivity` needs none of this: it is a Capacitor `BridgeActivity`, so it is an
 * AndroidX `ComponentActivity`, and `@capacitor/app` routes `backButton` through an
 * `OnBackPressedCallback` on its `OnBackPressedDispatcher` (AppPlugin.java), which
 * AndroidX bridges to the new dispatcher on its own. The two alarm surfaces are
 * plain `Activity` subclasses with no dispatcher to bridge for them, so they each
 * register with the platform directly. `onBackPressed` stays for API 22 to 32, which
 * this app still supports.
 *
 * **Enabled means "swallow it".** A registered callback consumes the gesture, so
 * enabling with a body that does nothing is exactly what makes Back inert on a
 * ringing alarm. Disabled hands Back back to the system, which finishes the activity
 * with its own animation, so a surface that only *sometimes* claims Back should
 * toggle rather than always intercept and call `finish()` itself: that would be
 * correct but would lose the predictive animation the system draws for free.
 */
class BackInterception(private val activity: Activity, private val onBack: () -> Unit) {

    /** The registered `OnBackInvokedCallback`, held as `Any` so this class carries no
     *  API-33 type in its own signature on the older devices that never load [Api33]. */
    private var registered: Any? = null

    /** Whether Back is currently being intercepted, for the legacy path to consult. */
    val enabled: Boolean
        get() = registered != null || legacyEnabled

    private var legacyEnabled = false

    /** Start intercepting Back. Idempotent. */
    fun enable() {
        if (enabled) return
        legacyEnabled = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registered = Api33.register(activity, onBack)
        }
    }

    /** Stop intercepting, so Back reaches the system again. Idempotent. */
    fun disable() {
        legacyEnabled = false
        val callback = registered ?: return
        registered = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Api33.unregister(activity, callback)
        }
    }

    /**
     * The API 22 to 32 path: call from the activity's `onBackPressed` and let the
     * return value decide. `true` means this consumed the press; `false` means the
     * activity should fall through to `super.onBackPressed()`.
     *
     * On API 33+ this is never reached, because the platform stops calling
     * `onBackPressed` once a callback is registered.
     */
    fun handleLegacyBack(): Boolean {
        if (!legacyEnabled) return false
        onBack()
        return true
    }

    /** Every reference to the API 33 back API, isolated so nothing else names it. */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private object Api33 {
        fun register(activity: Activity, onBack: () -> Unit): OnBackInvokedCallback {
            val callback = OnBackInvokedCallback { onBack() }
            activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                callback
            )
            return callback
        }

        fun unregister(activity: Activity, callback: Any) {
            activity.onBackInvokedDispatcher
                .unregisterOnBackInvokedCallback(callback as OnBackInvokedCallback)
        }
    }
}
