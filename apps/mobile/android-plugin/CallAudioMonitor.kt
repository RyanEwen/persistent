package ca.persistent.app.alarm

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/** Observes communication audio without phone permissions or access to call details. */
class CallAudioMonitor(context: Context, private val changed: () -> Unit) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private var listener: AudioManager.OnModeChangedListener? = null
    private var lastBusy = isBusy(context)
    private val poll = object : Runnable {
        override fun run() {
            val busy = isBusy(context)
            if (busy != lastBusy) {
                lastBusy = busy
                changed()
            }
            handler.postDelayed(this, 1000L)
        }
    }

    /** Modern Android reports immediately; older devices are checked once per second. */
    fun start() {
        if (Build.VERSION.SDK_INT >= 31) {
            val callback = AudioManager.OnModeChangedListener { changed() }
            listener = callback
            audio.addOnModeChangedListener({ task -> handler.post(task) }, callback)
        } else {
            handler.post(poll)
        }
    }

    /** Releases callbacks when the foreground alarm service stops. */
    fun stop() {
        handler.removeCallbacks(poll)
        if (Build.VERSION.SDK_INT >= 31) {
            listener?.let { audio.removeOnModeChangedListener(it) }
            listener = null
        }
    }

    companion object {
        /** Ringing, screening, redirected calls and VoIP all reserve communication audio. */
        fun isBusy(context: Context): Boolean {
            val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            return audio.mode != AudioManager.MODE_NORMAL
        }
    }
}
