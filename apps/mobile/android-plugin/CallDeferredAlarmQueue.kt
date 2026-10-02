package ca.persistent.app.alarm

/** Keeps call-deferred alarms independent, in arrival order, until handled or resumed. */
class CallDeferredAlarmQueue {
    private val pending = LinkedHashMap<String, AlarmSpec>()

    /** An escalation or duplicate updates the same obligation without changing its order. */
    fun defer(spec: AlarmSpec) {
        pending[spec.occurrenceId] = spec
    }

    operator fun contains(occurrenceId: String): Boolean = pending.containsKey(occurrenceId)

    /** Done, Snooze, De-escalate and remote cancellation all remove the waiting obligation. */
    fun remove(occurrenceId: String) {
        pending.remove(occurrenceId)
    }

    fun clear() {
        pending.clear()
    }

    /** Snapshot for durable recovery, preserving the live escalation spec. */
    fun all(): List<AlarmSpec> = pending.values.toList()

    /** Returns pending alarms once when communication ends; a continuing call drains nothing. */
    fun resume(callBusy: Boolean): List<AlarmSpec> {
        if (callBusy) return emptyList()
        val ready = all()
        clear()
        return ready
    }
}
