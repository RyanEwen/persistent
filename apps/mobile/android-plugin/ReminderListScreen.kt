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
 * The Android Auto root screen: everything the device knows about, in three sections —
 * what is nagging now, what is still to come, and the notes kept to be read.
 *
 * **Direct flavor only**; see [ReminderCarAppService] for why.
 *
 * This is the surface that made it reasonable to stop dumping the backlog into the car
 * on connect. A standing nag no longer announces itself when the car starts, so it has
 * to be *findable*, and this is where it is found — at the driver's own pace instead of
 * as a burst of cards they didn't ask for.
 *
 * Head units cap how many rows one list may carry, and the cap is lower while driving
 * (six, on some units). The cap is the host's and can't be argued with, so the list
 * **pages** instead: each screen fills to the cap and hands the rest to another copy of
 * itself behind a "More reminders" row. That is what makes "all of them" reachable
 * without ever handing the host a template it will reject.
 *
 * @param offset how many rows the screens before this one already showed.
 */
class ReminderListScreen(carContext: CarContext, private val offset: Int = 0) : Screen(carContext) {

    init {
        redrawOnReminderChanges()
    }

    override fun onGetTemplate(): Template {
        val all = CarReminders.load(carContext)
        // Only the root screen speaks for an empty device; a page reached by "More" that
        // has since emptied out is a stale screen, and its own emptiness says so.
        if (all.isEmpty()) return emptyTemplate()

        // One row of the budget is spent on "More" whenever there is a next page, so the
        // page itself gets one fewer — a full page plus the row would exceed the cap.
        val limit = carContext.getCarService(ConstraintManager::class.java)
            .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)
            .coerceAtLeast(2)
        val remaining = all.drop(offset)
        val more = remaining.size > limit
        val page = if (more) remaining.take(limit - 1) else remaining

        val now = System.currentTimeMillis()
        // Sorted due-first with the notes last (CarReminders.load), so a page break falls
        // between whole groups far more often than through the middle of one.
        val due = page.filter { it.due && !it.note }
        val upcoming = page.filter { !it.due && !it.note }
        val notes = page.filter { it.note }

        val template = ListTemplate.Builder()
            .setTitle(if (offset == 0) "Reminders" else "More reminders")
            .setHeaderAction(if (offset == 0) Action.APP_ICON else Action.BACK)
        if (due.isNotEmpty()) {
            template.addSectionedList(SectionedItemList.create(itemList(due, now), "Needs attention"))
        }
        if (upcoming.isNotEmpty()) {
            template.addSectionedList(SectionedItemList.create(itemList(upcoming, now), "Coming up"))
        }
        if (notes.isNotEmpty()) {
            template.addSectionedList(SectionedItemList.create(itemList(notes, now), "Notes"))
        }
        if (more) {
            // Its own section, so it can never be mistaken for a reminder, and it SAYS how
            // many are behind it — a driver deciding whether to look deserves the number.
            val hidden = remaining.size - page.size
            val label = if (hidden == 1) "1 more reminder" else "$hidden more reminders"
            val row = Row.Builder()
                .setTitle(label)
                .setBrowsable(true)
                .setOnClickListener {
                    screenManager.push(ReminderListScreen(carContext, offset + page.size))
                }
                .build()
            template.addSectionedList(SectionedItemList.create(ItemList.Builder().addItem(row).build(), "More"))
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
                // Addressed by CarReminder.key, not the occurrence id: a note and a
                // projected future firing have no occurrence, and both are still openable.
                .setOnClickListener { screenManager.push(ReminderDetailScreen(carContext, reminder.key)) }
            // The body is the firing's UNTICKED checklist items (cut server-side), so a
            // ticked-off item is already gone from it here exactly as it is everywhere else.
            if (reminder.body.isNotBlank()) row.addText(reminder.body.lineSequence().first())
            list.addItem(row.build())
        }
        return list.build()
    }

    /**
     * Nothing to show. That is either a genuinely clear list or a device that has never
     * synced, and the difference matters to a driver wondering why the car is empty —
     * so a device with no API origin recorded is told to sign in rather than told that
     * all is well.
     */
    private fun emptyTemplate(): Template {
        val message = if (AlarmStore.apiBaseUrl(carContext).isEmpty()) {
            "Open Persistent on your phone and sign in."
        } else {
            "Nothing due, and nothing scheduled this week."
        }
        return MessageTemplate.Builder(message)
            .setTitle("Reminders")
            .setHeaderAction(Action.APP_ICON)
            .build()
    }
}
