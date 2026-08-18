package ca.persistent.app.alarm

import android.content.Context
import java.util.concurrent.TimeUnit

/**
 * The reminder set the Android Auto screens list, and how to phrase it.
 *
 * **Direct flavor only** (see `setup-android.mjs`, `DIRECT_ONLY_KT`) — it exists to
 * serve `ReminderCarAppService`, which the Play build doesn't ship.
 *
 * Read from three local sources, never a car-specific fetch, so the list works offline
 * and with the WebView dead exactly as the alarms do:
 *
 * - [AlarmStore] — the alarm set the last sync armed (everything due plus the server's
 *   48-hour window). **Authoritative** where it overlaps: it is what the phone is
 *   about to ring, so nothing here can disagree with it.
 * - [AlarmService]'s live sets — which of those are showing, ringing, silenceable.
 * - [AgendaStore] — the wider set the same sync said the device may *show*: out to a
 *   week, plus the notes, none of it armed. This is what makes the screen answer "my
 *   reminders" rather than "my next two days of alarms".
 *
 * It reads only. Acting on a reminder goes through the same companion entry points the
 * notification actions use ([AlarmService.markDone] and friends), so a Done from the
 * car reaches the server and re-arms locally by the established path.
 */
data class CarReminder(
    /**
     * Empty unless this row is a real firing. A note never has one, and neither does a
     * *projected* future firing — the server expands the week past its materialized
     * horizon without writing rows for it, so those exist only as a line on this list.
     * Both cases are what makes a row unactionable: there is nothing yet to confirm.
     */
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
    val canSilence: Boolean,
    /** A note: kept to be read, never fires, nothing to confirm. */
    val note: Boolean = false
) {
    /**
     * How a screen re-finds this row after a redraw. The occurrence id where there is one;
     * otherwise the reminder and the instant, which is unique for anything without one (a
     * note's instant is 0, and a reminder can't fire twice in the same millisecond).
     *
     * Rows are addressed by this rather than by occurrence id precisely so a row that has
     * no firing can still be opened — and so nothing can mistake such a key for a firing
     * to act on.
     */
    val key: String get() = if (occurrenceId.isNotEmpty()) occurrenceId else "$reminderId@$fireAtMs"

    /**
     * Whether Done / Snooze mean anything for this row. False for a note and for a
     * projected firing (no occurrence to act on), and false before it fires — the same
     * rule the phone follows: you act on a notification, and there isn't one yet.
     */
    val actionable: Boolean get() = !note && due && occurrenceId.isNotEmpty()
}

object CarReminders {

    /**
     * Everything the device currently knows about, due first and then in fire order,
     * with the notes last — they have no time, so they belong to no point in that order.
     *
     * The armed set goes in first and the agenda only fills what it didn't cover, so an
     * occurrence the device holds an alarm for is described by that alarm: its live
     * ringing/silenceable state comes from [AlarmService], which the agenda knows
     * nothing about. Beyond the armed window the agenda is all there is.
     *
     * The `::esc` escalation twins are folded away: an escalation upgrades the base
     * occurrence in place and shares its one notification, so listing both would show
     * the same reminder twice with nothing to tell them apart.
     */
    fun load(context: Context): List<CarReminder> {
        val now = System.currentTimeMillis()
        val armed = AlarmStore.all(context)
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
        val armedIds = armed.map { it.occurrenceId }.toSet()
        val agenda = AgendaStore.all(context)
            .filter { it.note || it.occurrenceId !in armedIds }
            .map { entry ->
                CarReminder(
                    occurrenceId = entry.occurrenceId,
                    reminderId = entry.reminderId,
                    title = entry.title,
                    body = entry.body,
                    fireAtMs = entry.fireAtMs,
                    // An agenda firing can be due — the device may have been out of
                    // touch long enough for one to come round — but never *ringing*:
                    // nothing armed it, so there is no local alarm to be sounding.
                    due = !entry.note && entry.fireAtMs <= now,
                    ringing = false,
                    canSilence = false,
                    note = entry.note
                )
            }
        val (notes, timed) = (armed + agenda).partition { it.note }
        return timed.sortedWith(compareByDescending<CarReminder> { it.due }.thenBy { it.fireAtMs }) +
            notes.sortedBy { it.title.lowercase() }
    }

    /** Re-find a row by its [CarReminder.key] — see there for why not by occurrence id. */
    fun find(context: Context, key: String): CarReminder? =
        if (key.isEmpty()) null else load(context).firstOrNull { it.key == key }

    /**
     * The one-line status a row carries under its title: how overdue a nag is, or how
     * long until the next one fires. Deliberately relative rather than a clock time —
     * a driver reads "in 20 min" at a glance, and it needs no time-zone or 12/24-hour
     * handling to be right.
     */
    fun timing(reminder: CarReminder, nowMs: Long): String {
        // A note has no time at all, so it says what it is instead of when it is.
        if (reminder.note) return "Kept note — never notifies you"
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
