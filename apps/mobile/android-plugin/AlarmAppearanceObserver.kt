package ca.persistent.app.alarm

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.view.View
import androidx.core.content.ContextCompat

/** Restyle attached alarm views without rebuilding confirmations, drafts, or picker state. */
internal class AlarmAppearanceObserver(private val activity: Activity, private val root: View) :
    View.OnAttachStateChangeListener, ComponentCallbacks {

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            AlarmUi.refresh(activity, root)
        }
    }

    override fun onViewAttachedToWindow(view: View) {
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(AlarmAppearance.ACTION_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        activity.registerComponentCallbacks(this)
        AlarmUi.refresh(activity, root)
    }

    override fun onViewDetachedFromWindow(view: View) {
        activity.unregisterReceiver(receiver)
        activity.unregisterComponentCallbacks(this)
    }

    override fun onConfigurationChanged(configuration: Configuration) {
        // Configuration is propagated to the Activity's resources after application callbacks.
        root.post { AlarmUi.refresh(activity, root) }
    }

    override fun onLowMemory() = Unit
}
