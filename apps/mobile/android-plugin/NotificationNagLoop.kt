package ca.persistent.app.alarm

/** Owns follow-up timers, preserving their deadlines until an interval actually changes. */
class NotificationNagLoop(
    private val schedule: (Runnable, Long) -> Unit,
    private val cancel: (Runnable) -> Unit,
    private val notify: (String) -> Unit
) {
    private data class Loop(val seconds: Int, val callback: Runnable)
    private val active = HashMap<String, Loop>()

    /** A changed interval starts a full new wait; zero disables nags without clearing the notification. */
    fun update(occurrenceId: String, seconds: Int) {
        if (active[occurrenceId]?.seconds == seconds) return
        remove(occurrenceId)
        if (seconds <= 0) return

        val callback = object : Runnable {
            override fun run() {
                if (active[occurrenceId]?.callback !== this) return
                notify(occurrenceId)
                if (active[occurrenceId]?.callback === this) {
                    schedule(this, seconds * 1000L)
                }
            }
        }
        active[occurrenceId] = Loop(seconds, callback)
        schedule(callback, seconds * 1000L)
    }

    /** Cancels a firing's pending follow-up, including callbacks already dequeued by the scheduler. */
    fun remove(occurrenceId: String) {
        active.remove(occurrenceId)?.let { cancel(it.callback) }
    }

    /** Cancels all follow-ups on service teardown or account reset. */
    fun clear() {
        active.keys.toList().forEach { remove(it) }
    }
}
