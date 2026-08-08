package ca.persistent.app.alarm

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SectionedItemList
import androidx.car.app.model.Template

/**
 * The Android Auto root screen: everything the device knows about, in two sections —
 * what is nagging now, and what is still to come.
 *
 * **Direct flavor only**; see [ReminderCarAppService] for why.
 *
 * This is the surface that made it reasonable to stop dumping the backlog into the car
 * on connect. A standing nag no longer announces itself when the car starts, so it has
 * to be *findable*, and this is where it is found — at the driver's own pace instead of
 * as a burst of cards they didn't ask for.
 */
class ReminderListScreen(carContext: CarContext) : Screen(carContext) {

    init {
        redrawOnReminderChanges()
    }

    override fun onGetTemplate(): Template {
        val reminders = CarReminders.load(carContext)
        if (reminders.isEmpty()) return emptyTemplate()

        // Head units cap how many rows a list may carry, and the cap is lower while
        // driving. Truncate to it deliberately and SAY SO in the section header, so a
        // short list is never mistaken for a complete one.
        val limit = carContext.getCarService(ConstraintManager::class.java)
            .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)
            .coerceAtLeast(1)
        val hidden = (reminders.size - limit).coerceAtLeast(0)
        val note = if (hidden > 0) " (+$hidden not shown)" else ""

        val now = System.currentTimeMillis()
        // Sorted due-first, so truncation always drops the furthest-out entries and the
        // note belongs on whichever section ends up last.
        val (due, upcoming) = reminders.take(limit).partition { it.due }

        val template = ListTemplate.Builder()
            .setTitle("Reminders")
            .setHeaderAction(Action.APP_ICON)
        if (due.isNotEmpty()) {
            val header = if (upcoming.isEmpty()) "Needs attention$note" else "Needs attention"
            template.addSectionedList(SectionedItemList.create(itemList(due, now), header))
        }
        if (upcoming.isNotEmpty()) {
            template.addSectionedList(SectionedItemList.create(itemList(upcoming, now), "Coming up$note"))
        }
        return template.build()
    }

    private fun itemList(reminders: List<CarReminder>, now: Long): ItemList {
        val list = ItemList.Builder()
        for (reminder in reminders) {
            val row = Row.Builder()
                .setTitle(reminder.title)
                // Two texts is the per-row maximum: when it fires, then what it's for.
                .addText(CarReminders.timing(reminder, now))
                .setBrowsable(true)
                .setOnClickListener { screenManager.push(ReminderDetailScreen(carContext, reminder.occurrenceId)) }
            // The body is the firing's UNTICKED checklist items (cut server-side), so a
            // ticked-off item is already gone from it here exactly as it is everywhere else.
            if (reminder.body.isNotBlank()) row.addText(reminder.body.lineSequence().first())
            list.addItem(row.build())
        }
        return list.build()
    }

    /**
     * Nothing armed. That is either a genuinely clear list or a device that has never
     * synced, and the difference matters to a driver wondering why the car is empty —
     * so a device with no API origin recorded is told to sign in rather than told that
     * all is well.
     */
    private fun emptyTemplate(): Template {
        val message = if (AlarmStore.apiBaseUrl(carContext).isEmpty()) {
            "Open Persistent on your phone and sign in."
        } else {
            "Nothing due, and nothing scheduled in the next 48 hours."
        }
        return MessageTemplate.Builder(message)
            .setTitle("Reminders")
            .setHeaderAction(Action.APP_ICON)
            .build()
    }
}
