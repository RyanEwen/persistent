package ca.persistent.app.alarm

import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/**
 * How long to snooze a reminder for, chosen in the car.
 *
 * **Direct flavor only**; see [ReminderCarAppService] for why.
 *
 * A fixed short list rather than the phone picker's custom duration
 * ([SnoozePickerActivity]): typing a number is not something to do while driving, and
 * the spoken car reply already covers an arbitrary "snooze 25 minutes". These are the
 * durations that make sense for the length of a drive.
 *
 * It routes through the same [AlarmService.snooze] as every other surface, so the
 * server learns about it and the local re-fire is armed identically.
 */
class CarSnoozeScreen(carContext: CarContext, private val occurrenceId: String) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val list = ItemList.Builder()
        for ((label, minutes) in OPTIONS) {
            list.addItem(
                Row.Builder()
                    .setTitle(label)
                    .setOnClickListener {
                        AlarmService.snooze(carContext, occurrenceId, minutes)
                        CarToast.makeText(carContext, "Snoozed $label", CarToast.LENGTH_SHORT).show()
                        // Back to the list, not to the detail screen: the reminder it was
                        // showing is no longer waiting on anything.
                        screenManager.popToRoot()
                    }
                    .build()
            )
        }
        return ListTemplate.Builder()
            .setTitle("Snooze for")
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .build()
    }

    private companion object {
        val OPTIONS = listOf(
            "10 minutes" to 10,
            "30 minutes" to 30,
            "1 hour" to 60,
            "2 hours" to 120
        )
    }
}
