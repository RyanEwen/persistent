package ca.persistent.app.alarm

import android.content.Context
import java.util.concurrent.TimeUnit

/**
 * The reminder set the Android Auto screens list, and how to phrase it.
 *
 * **Direct flavor only** (see `setup-android.mjs`, `DIRECT_ONLY_KT`) — it exists to
 * serve `ReminderCarAppService`, which the Play build doesn't ship.
 *
 * Read entirely from [AlarmStore] (the alarm set the last sync armed — everything due
 * plus the server's 48-hour window) and [AlarmService]'s live sets, so the car list
 * works offline and with the WebView dead, exactly as the alarms themselves do. No
 * separate car fetch, no new endpoint, and nothing here can disagree with what the
 * phone is about to ring.
 *
 * It reads only. Acting on a reminder goes through the same companion entry points the
 * notification actions use ([AlarmService.markDone] and friends), so a Done from the
 * car reaches the server and re-arms locally by the established path.
 */
data class CarReminder(
    val occurrenceId: String,
    val reminderId: String,
    val title: String,
    /** The firing's unticked checklist items / description — already cut server-side. */
    val body: String,
    val fireAtMs: Long,
    /** Fired and not yet confirmed: this one is nagging now. */
    val due: Boolean,
    /** Ringing as an alarm or escalation right now. */
    val ringing: Boolean,
    /** A ringing escalation the user may quiet back to a soft nag. */
    val canSilence: Boolean
)

object CarReminders {

    /**
     * Everything the device currently knows about, due first and then in fire order.
     *
     * The `::esc` escalation twins are folded away: an escalation upgrades the base
     * occurrence in place and shares its one notification, so listing both would show
     * the same reminder twice with nothing to tell them apart.
     */
    fun load(context: Context): List<CarReminder> {
        val now = System.currentTimeMillis()
        return AlarmStore.all(context)
            .filter { !it.occurrenceId.endsWith(AlarmReceiver.ESC_SUFFIX) }
            .map { spec ->
                CarReminder(
                    occurrenceId = spec.occurrenceId,
                    reminderId = spec.reminderId,
                    title = spec.title,
                    body = spec.body,
                    fireAtMs = spec.fireAtMs,
                    // An armed alarm outlives its fire in the store — it's removed only on
                    // Done/snooze — so a fire time in the past means "fired, unconfirmed".
                    // That's the same rule AlarmService.ensureNags re-posts on.
                    due = AlarmService.isActive(spec.occurrenceId) || spec.fireAtMs <= now,
                    ringing = AlarmService.isAlarmActive(spec.occurrenceId),
                    canSilence = AlarmService.isSilenceable(spec.occurrenceId)
                )
            }
            .sortedWith(compareByDescending<CarReminder> { it.due }.thenBy { it.fireAtMs })
    }

    fun find(context: Context, occurrenceId: String): CarReminder? =
        load(context).firstOrNull { it.occurrenceId == occurrenceId }

    /**
     * The one-line status a row carries under its title: how overdue a nag is, or how
     * long until the next one fires. Deliberately relative rather than a clock time —
     * a driver reads "in 20 min" at a glance, and it needs no time-zone or 12/24-hour
     * handling to be right.
     */
    fun timing(reminder: CarReminder, nowMs: Long): String {
        if (reminder.ringing) return "Ringing now"
        val deltaMs = reminder.fireAtMs - nowMs
        if (reminder.due) {
            val overdue = -deltaMs
            // Under a minute either way reads as "just now" more honestly than "0 min ago".
            return if (overdue < TimeUnit.MINUTES.toMillis(1)) "Due now" else "Due ${duration(overdue)} ago"
        }
        return if (deltaMs < TimeUnit.MINUTES.toMillis(1)) "Due now" else "In ${duration(deltaMs)}"
    }

    /** A coarse "2 h 15 min" / "3 days" phrasing — precision no driver needs. */
    private fun duration(ms: Long): String {
        val minutes = TimeUnit.MILLISECONDS.toMinutes(ms)
        if (minutes < 60) return "$minutes min"
        val hours = minutes / 60
        if (hours < 24) {
            val rest = minutes % 60
            return if (rest == 0L) plural(hours, "hour") else "$hours h $rest min"
        }
        return plural(hours / 24, "day")
    }

    private fun plural(value: Long, unit: String): String = if (value == 1L) "1 $unit" else "$value ${unit}s"
}
