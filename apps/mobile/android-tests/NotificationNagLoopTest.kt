package ca.persistent.app.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exercises edited nag deadlines without waiting for real time or using Android hardware. */
class NotificationNagLoopTest {
    private class Clock {
        var now = 0L
        val pending = LinkedHashMap<Runnable, Long>()
        val alerts = mutableListOf<String>()
        val loops = NotificationNagLoop(
            schedule = { callback, delay -> pending[callback] = now + delay },
            cancel = { callback -> pending.remove(callback) },
            notify = { id -> alerts.add(id) }
        )

        fun advance(seconds: Int) {
            val target = now + seconds * 1000L
            while (true) {
                val next = pending.minByOrNull { it.value } ?: break
                if (next.value > target) break
                now = next.value
                pending.remove(next.key)
                next.key.run()
            }
            now = target
        }
    }

    @Test fun editingFifteenMinutesToOneHourCancelsOldDeadlineWithoutAlerting() {
        val clock = Clock()
        clock.loops.update("live", 900)
        clock.advance(300)
        val stale = clock.pending.keys.single()
        clock.loops.update("live", 3600)
        stale.run()
        clock.advance(3599)
        assertTrue(clock.alerts.isEmpty())
        assertEquals(1, clock.pending.size)
        clock.advance(1)
        assertEquals(listOf("live"), clock.alerts)
        clock.advance(3600)
        assertEquals(listOf("live", "live"), clock.alerts)
    }

    @Test fun routineSyncDoesNotPostponeNagAndShorterIntervalTakesEffect() {
        val clock = Clock()
        clock.loops.update("live", 3600)
        clock.advance(600)
        clock.loops.update("live", 3600)
        clock.advance(3000)
        assertEquals(listOf("live"), clock.alerts)
        clock.loops.update("live", 900)
        clock.advance(900)
        assertEquals(listOf("live", "live"), clock.alerts)
    }

    @Test fun disablingNagsAndClearingCancelTimersIndependently() {
        val clock = Clock()
        clock.loops.update("first", 900)
        clock.loops.update("second", 900)
        clock.loops.update("first", 0)
        clock.advance(900)
        assertEquals(listOf("second"), clock.alerts)
        clock.loops.clear()
        clock.advance(3600)
        assertTrue(clock.pending.isEmpty())
        assertEquals(listOf("second"), clock.alerts)
    }

    private fun spec() = AlarmSpec(
        occurrenceId = "live", fireAtMs = 0, title = "Reminder", body = "",
        soundIntervalSeconds = 900, alarm = false, ongoing = true, soundUri = "old"
    )

    @Test fun intervalOnlyEditAndToneEditReachActiveNotification() {
        val current = spec()
        val stored = current.copy(soundIntervalSeconds = 3600, soundUri = "new", nagSoundUri = "nag")
        val updated = current.refreshNotificationFrom(stored)
        assertEquals(3600, updated.soundIntervalSeconds)
        assertEquals("new", updated.soundUri)
        assertEquals("nag", updated.nagSoundUri)
    }

    @Test fun refreshPreservesLocalEscalationAndSilenceState() {
        val stored = spec().copy(soundIntervalSeconds = 3600)
        val escalated = spec().copy(alarm = true, canSilence = true, soundUri = "alarm")
        val refreshed = escalated.refreshNotificationFrom(stored)
        assertTrue(refreshed.alarm)
        assertTrue(refreshed.canSilence)
        assertEquals("alarm", refreshed.soundUri)
        val silenced = spec().refreshNotificationFrom(stored.copy(alarm = true, canSilence = true))
        assertFalse(silenced.alarm)
        assertFalse(silenced.canSilence)
    }
}
