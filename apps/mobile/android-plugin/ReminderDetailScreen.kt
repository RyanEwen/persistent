package ca.persistent.app.alarm

import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

/**
 * One reminder in the car: its full body, and the actions that apply to it.
 *
 * **Direct flavor only**; see [ReminderCarAppService] for why.
 *
 * **Done is deliberately one screen in from the list.** The phone's shade action asks
 * for a second confirming tap because a notification can be brushed in a pocket; a car
 * screen can't be, but a stray touch on a moving list still can. Reaching a reminder's
 * own screen first is the same guard by a different route — two intentional taps before
 * anything is marked complete — so this offers Done outright rather than repeating the
 * confirm dance on a surface where reading takes attention off the road.
 *
 * Actions are offered only for a firing that has actually happened
 * ([CarReminder.actionable]). A reminder that has yet to fire has nothing to confirm or
 * postpone, so it reads as detail only, matching the notification surface, which likewise
 * offers nothing before the fire. A **note** never has a firing at all, and neither does a
 * *projected* one from beyond the materialized horizon, so both are always detail only.
 *
 * Addressed by [CarReminder.key] rather than an occurrence id, because those two rows have
 * no occurrence to name. The actions read `occurrenceId` off the row they found, so the
 * only thing they can ever act on is a real firing.
 */
class ReminderDetailScreen(carContext: CarContext, private val key: String) : Screen(carContext) {

    init {
        redrawOnReminderChanges()
    }

    override fun onGetTemplate(): Template {
        // Confirmed on another device, or the sync dropped it, while this screen was up.
        val reminder = CarReminders.find(carContext, key)
            ?: return MessageTemplate.Builder("This reminder is no longer on this device.")
                .setTitle("Reminders")
                .setHeaderAction(Action.BACK)
                .build()

        val now = System.currentTimeMillis()
        val message = listOf(CarReminders.timing(reminder, now), reminder.body)
            .filter { it.isNotBlank() }
            .joinToString("\n\n")
        val template = MessageTemplate.Builder(message)
            .setTitle(reminder.title)
            .setHeaderAction(Action.BACK)

        if (reminder.actionable) {
            template.addAction(
                Action.Builder()
                    .setTitle("Done")
                    .setBackgroundColor(CarColor.GREEN)
                    .setOnClickListener {
                        AlarmService.markDone(carContext, reminder.occurrenceId)
                        toastAndReturn("Marked done")
                    }
                    .build()
            )
            template.addAction(
                Action.Builder()
                    .setTitle("Snooze")
                    .setOnClickListener { screenManager.push(CarSnoozeScreen(carContext, reminder.occurrenceId)) }
                    .build()
            )
        }
        // De-escalating stops an escalation ringing but leaves the reminder nagging, so it
        // is not a way out of the guarantee and belongs on the strip rather than beside
        // Done. Offered exactly when the notification offers it (see AlarmService.silenceableIds).
        if (reminder.canSilence) {
            template.setActionStrip(
                ActionStrip.Builder()
                    .addAction(
                        Action.Builder()
                            .setTitle("De-escalate")
                            .setOnClickListener {
                                AlarmService.silence(carContext, reminder.occurrenceId)
                                CarToast.makeText(carContext, "Alarm stopped, still nagging", CarToast.LENGTH_LONG).show()
                                invalidate()
                            }
                            .build()
                    )
                    .build()
            )
        }
        return template.build()
    }

    private fun toastAndReturn(message: String) {
        CarToast.makeText(carContext, message, CarToast.LENGTH_SHORT).show()
        screenManager.popToRoot()
    }
}
