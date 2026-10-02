package ca.persistent.app.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exercises call deferral independently of Android UI and audio hardware. */
class CallDeferredAlarmQueueTest {
    private fun alarm(id: String, canSilence: Boolean = false) = AlarmSpec(
        occurrenceId = id, fireAtMs = 0, title = id, body = "", alarm = true,
        soundIntervalSeconds = 0, ongoing = true, soundUri = "",
        canSilence = canSilence
    )

    @Test fun ignoredAlarmsWaitThroughCallThenResumeOnceInArrivalOrder() {
        val queue = CallDeferredAlarmQueue()
        queue.defer(alarm("first"))
        queue.defer(alarm("second"))
        assertTrue(queue.resume(callBusy = true).isEmpty())
        assertEquals(listOf("first", "second"), queue.resume(callBusy = false).map { it.occurrenceId })
        assertTrue(queue.resume(callBusy = false).isEmpty())
    }

    @Test fun handledAlarmNeverResumesButOtherAlarmsRemainPending() {
        val queue = CallDeferredAlarmQueue()
        queue.defer(alarm("handled"))
        queue.defer(alarm("ignored"))
        queue.remove("handled")
        assertEquals(listOf("ignored"), queue.resume(false).map { it.occurrenceId })
    }

    @Test fun duplicateOrEscalationRefreshesFullSpecWithoutDuplicatingOrReordering() {
        val queue = CallDeferredAlarmQueue()
        queue.defer(alarm("first"))
        queue.defer(alarm("second"))
        queue.defer(alarm("first", canSilence = true).copy(soundUri = "custom-tone"))
        val restored = CallDeferredAlarmQueue()
        queue.all().forEach { restored.defer(it) }
        val ready = restored.resume(false)
        assertEquals(listOf("first", "second"), ready.map { it.occurrenceId })
        assertTrue(ready.first().canSilence)
        assertEquals("custom-tone", ready.first().soundUri)
    }

    @Test fun clearingAllPreventsCallEndFromRevivingAlarms() {
        val queue = CallDeferredAlarmQueue()
        queue.defer(alarm("old-account"))
        queue.clear()
        assertTrue(queue.resume(false).isEmpty())
    }
}
