package ca.persistent.app.alarm

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import ca.persistent.app.alarm.AlarmUi.addStacked

/**
 * Full-screen alarm UI launched over the lock screen by the full-screen intent.
 * Big "Done" / "Snooze" buttons; Done is the only thing that stops a PERSISTENT/
 * ALARM reminder. Built in code to avoid shipping XML resources with the plugin.
 *
 * **It is a queue, not a screen.** Occurrences are independent
 * (`notification-behavior.md` §4), so several can ring at once — a 9:00 dose still
 * unconfirmed when the 13:00 one escalates, or simply two reminders set to the same
 * minute. This surface pages through every ringing alarm: swipe between them, an
 * indicator says which of how many, and dealing with one moves to the next rather
 * than leaving the rest with no surface at all.
 *
 * Before this it showed exactly one, launched with `CLEAR_TASK`, so a second alarm
 * destroyed the first's surface and `finish()` after Done left any remaining alarm
 * ringing with nothing on screen — recoverable only by finding its notification.
 *
 * The queue is ordered oldest-ringing-first and never reshuffles (see
 * `AlarmService.ringingAlarms`): a new alarm joins the end rather than displacing
 * anything, and it pages into view, because it is the event that just happened.
 * That is safe even mid-confirm — `confirming` is per-occurrence and the arriving
 * page renders un-armed, so a tap already on its way lands on that page's *Done*
 * (which only arms) and can never become an acknowledgement of either reminder.
 * Refusing to move instead was worse: `willPresentAlarmSurface` suppresses both the
 * heads-up banner and the full-screen intent whenever this surface is expected to
 * show the alarm, so a new alarm that this surface then declined to show would ring
 * with almost nothing on screen to identify it.
 */
class AlarmActivity : Activity() {

    /** The ringing alarms, in queue order. Re-read whenever the set changes. */
    private var alarms: List<AlarmSpec> = emptyList()

    /** Occurrences whose Done has been armed but not confirmed, kept across rebinds. */
    private val confirming = HashSet<String>()

    private lateinit var pager: ViewPager2
    private lateinit var dotsHolder: LinearLayout

    // Back is inert here, and stays inert on both of Android's back mechanisms: a
    // registered callback that does nothing swallows the gesture. Enabled for the
    // whole life of the surface, since there is no state in which Back should leave
    // a ringing alarm. See BackInterception.
    private val back = BackInterception(this) {}

    /**
     * Drop an occurrence from the queue when it is silenced/acked/snoozed/cleared from
     * anywhere else (the shade action, another device's WS event, the in-app button,
     * or this surface's own buttons).
     *
     * This is what "dealing with one brings you to the next" is built on: the page
     * goes away and the pager lands on its neighbour. Only an empty queue finishes the
     * activity — a stale surface over a handled alarm is what this receiver has always
     * existed to prevent, but so is finishing while something is still ringing.
     */
    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val target = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID)
            if (target == null) {
                finish()
                return
            }
            confirming.remove(target)
            refreshQueue(preferId = null)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        back.enable()

        ContextCompat.registerReceiver(
            this,
            dismissReceiver,
            IntentFilter(ACTION_DISMISS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        pager = ViewPager2(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            adapter = AlarmPagerAdapter()
            registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
                override fun onPageSelected(position: Int) {
                    // Leaving a page disarms its confirm. Arming Done, swiping away and
                    // coming back to a still-armed button would leave the next tap one
                    // tap from an acknowledgement the user had moved on from.
                    // Guarded: ViewPager2 can re-dispatch this after a data-set change,
                    // and a position that doesn't resolve yet would otherwise clear the
                    // confirm on a page the user never left.
                    val current = alarms.getOrNull(position)?.occurrenceId ?: return
                    confirming.retainAll { it == current }
                    updateIndicator()
                }
            })
        }

        dotsHolder = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, AlarmUi.dp(this@AlarmActivity, 20f))
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = AlarmUi.screenBackground()
            addView(pager)
            addView(
                dotsHolder,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            )
        }

        setContentView(root)
        // API 35 enforces edge-to-edge; without this the alarm's buttons sit under
        // the system bars. See AlarmUi.applySystemBarInsets.
        AlarmUi.applySystemBarInsets(root)

        refreshQueue(preferId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID), coldStart = true)
    }

    /**
     * A second alarm started ringing, or this alarm's notification was tapped while the
     * surface was already up.
     *
     * Both arrive here rather than as a fresh activity because the launch flags dropped
     * `CLEAR_TASK` (see `AlarmService.presentAlarmSurface`). Without this override the
     * intent would be delivered to a `singleInstance` activity that ignored it, leaving
     * the surface showing the previous alarm while the new one rang unseen.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Page to whatever the intent names — a notification tap is a request for that
        // reminder, and a newly-fired alarm is the event that just happened. The queue's
        // own order never changes; only the visible page moves.
        //
        // EXTRA_KEEP_PAGE is the exception: a screen-on/unlock re-present has to name an
        // alarm in order to launch at all, but is not a request for that one.
        if (intent.getBooleanExtra(EXTRA_KEEP_PAGE, false)) refreshQueue(preferId = null)
        else refreshQueue(preferId = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID))
    }

    /**
     * Re-read the ringing queue and redraw, keeping the user where they were.
     *
     * @param preferId page to this occurrence if it is still ringing — a notification
     *   tap is a request for that reminder, and a newly-fired alarm is the event that
     *   just happened. Otherwise hold the current page's occurrence, and failing that
     *   (it was just handled) land on whatever took its place: the next one to deal
     *   with. The queue's own order never changes, so only this decides the page.
     */
    private fun refreshQueue(preferId: String?, coldStart: Boolean = false) {
        val previous = alarms.getOrNull(pager.currentItem)?.occurrenceId
        val previousIndex = pager.currentItem
        // The intent fallback is for a cold start ONLY. Reaching for it on a refresh
        // would rebuild a page for the alarm the user just dealt with — the launching
        // intent always names one — so the surface could never empty and never close:
        // De-escalate would leave a page offering De-escalate again, and Done a page
        // offering Done, with Back inert and no way out but Home.
        val ringing = AlarmService.ringingAlarms()
        val next = if (ringing.isEmpty() && coldStart) alarmFromIntent() else ringing

        if (next.isEmpty()) {
            // Nothing left ringing: this surface is now the stale second alert the
            // dismiss broadcast exists to remove. Tell the adapter before finishing — a
            // getItemCount() that drops to 0 behind RecyclerView's back is the classic
            // "Inconsistency detected" crash if a layout pass beats the close.
            alarms = next
            pager.adapter?.notifyDataSetChanged()
            finish()
            return
        }

        // A dismiss for something that was never on this surface (an ordinary soft nag
        // clearing) reaches this receiver too. Rebinding every page for it would rebuild
        // the buttons under the user's finger and scroll the pager mid-drag, so leave an
        // unchanged queue alone.
        if (preferId == null && next.map { it.occurrenceId } == alarms.map { it.occurrenceId }) return

        alarms = next
        pager.adapter?.notifyDataSetChanged()

        val target = when {
            preferId != null && alarms.any { it.occurrenceId == preferId } ->
                alarms.indexOfFirst { it.occurrenceId == preferId }
            previous != null && alarms.any { it.occurrenceId == previous } ->
                alarms.indexOfFirst { it.occurrenceId == previous }
            // The page the user was on is gone (they just dealt with it), so the one
            // that slid into its place is the next one to deal with. Clamped, so
            // handling the last in the queue lands on the new last rather than nowhere.
            else -> previousIndex.coerceIn(0, alarms.size - 1)
        }
        pager.setCurrentItem(target, false)
        updateIndicator()
    }

    /**
     * The launching intent as a one-item queue, for when the service knows of nothing
     * ringing.
     *
     * That happens when the notification outlived the process that posted it — a
     * foreground service killed by memory pressure or an app update leaves the nag on
     * screen (`AlarmService.ensureNags` deliberately keeps it there), and tapping an
     * alarm's body opens this surface in a fresh process whose `ringingSpecs` is empty.
     * Finishing immediately would make that tap look like it did nothing. The intent
     * carries everything a page needs, which is exactly what this surface used before
     * it became a queue.
     */
    private fun alarmFromIntent(): List<AlarmSpec> {
        val id = intent.getStringExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID) ?: return emptyList()
        return listOf(
            AlarmSpec(
                occurrenceId = id,
                fireAtMs = 0,
                title = intent.getStringExtra("title") ?: "Reminder",
                body = intent.getStringExtra("body") ?: "",
                soundIntervalSeconds = 0,
                alarm = true,
                ongoing = true,
                soundUri = "",
                canSilence = intent.getBooleanExtra("canSilence", false)
            )
        )
    }

    /**
     * The dots, which are the only part of the indicator that depends on which page is
     * *showing*. The "REMINDER n OF m" line is drawn by the page itself: it describes
     * that page's own place in the queue, so it is a property of the position it was
     * bound at and never needs updating as the user swipes.
     */
    private fun updateIndicator() {
        dotsHolder.removeAllViews()
        dotsHolder.addView(AlarmUi.pageDots(this, alarms.size, pager.currentItem))
    }

    /** One ringing alarm per page: title, body, and its own Done / Snooze / De-escalate. */
    private inner class AlarmPagerAdapter : RecyclerView.Adapter<AlarmPagerAdapter.PageHolder>() {

        inner class PageHolder(val scroll: android.widget.ScrollView, val content: LinearLayout) :
            RecyclerView.ViewHolder(scroll)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageHolder {
            val scaffold = AlarmUi.scaffold(this@AlarmActivity)
            scaffold.root.layoutParams = RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            // The gradient lives on the activity root; a page painting its own would
            // draw a hard seam down the middle of every swipe.
            scaffold.root.background = null
            return PageHolder(scaffold.root, scaffold.content)
        }

        override fun getItemCount(): Int = alarms.size

        override fun onBindViewHolder(holder: PageHolder, position: Int) {
            val spec = alarms.getOrNull(position) ?: return
            val content = holder.content
            content.removeAllViews()
            // Inside the page, not in a header above the pager: it labels *this* title
            // and has to sit with it. Hoisting it out left it stranded at the top of the
            // screen with the reminder centred half a screen below.
            val label = if (alarms.size > 1) "REMINDER ${position + 1} OF ${alarms.size}" else "REMINDER"
            content.addStacked(AlarmUi.kicker(this@AlarmActivity, label))
            content.addStacked(AlarmUi.title(this@AlarmActivity, spec.title), topMarginDp = 6f)
            if (spec.body.isNotEmpty()) content.addStacked(AlarmUi.body(this@AlarmActivity, spec.body))

            // Done is a two-step confirm here too (matching the notification + in-app
            // button): the first tap swaps the buttons into "Confirm done" / "Not yet"
            // so a stray tap on the full-screen surface can't ack the alarm. The alarm
            // keeps ringing until the deliberate second tap. Both states live in a
            // swappable container so toggling rebuilds just the buttons.
            val actions = LinearLayout(this@AlarmActivity).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }
            lateinit var showNormal: () -> Unit
            lateinit var showConfirm: () -> Unit
            showNormal = {
                confirming.remove(spec.occurrenceId)
                actions.removeAllViews()
                actions.addView(
                    AlarmUi.pillButton(this@AlarmActivity, "Done", AlarmUi.ButtonStyle.PRIMARY, topMarginDp = 28f) {
                        showConfirm()
                    }
                )
                actions.addView(
                    AlarmUi.pillButton(this@AlarmActivity, "Snooze…", AlarmUi.ButtonStyle.SECONDARY, topMarginDp = 12f) {
                        startActivity(
                            Intent(this@AlarmActivity, SnoozePickerActivity::class.java)
                                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                        // Deliberately not finish(): the picker sits on top, and the
                        // snooze it takes broadcasts a dismiss for this occurrence
                        // alone. If others are still ringing this surface is still
                        // needed, and it will be showing the next one by the time the
                        // picker closes over it.
                    }
                )
                if (spec.canSilence) {
                    // Escalation only: stop the alarm but leave the reminder nagging
                    // ("De-escalate" is the user-facing label for the silence action).
                    actions.addView(
                        AlarmUi.pillButton(this@AlarmActivity, "De-escalate", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
                            sendAction(AlarmReceiver.ACTION_SILENCE, spec.occurrenceId)
                        }
                    )
                }
            }
            showConfirm = {
                confirming.add(spec.occurrenceId)
                actions.removeAllViews()
                actions.addStacked(
                    AlarmUi.body(this@AlarmActivity, "Tap \"Confirm done\" to mark this complete."),
                    topMarginDp = 28f
                )
                actions.addView(
                    AlarmUi.pillButton(this@AlarmActivity, "Confirm done", AlarmUi.ButtonStyle.PRIMARY, topMarginDp = 12f) {
                        // The deliberate confirm tap acks + stops (no app launch). The
                        // ack broadcasts a dismiss, which drops this page and pages to
                        // the next ringing alarm — or finishes if it was the last.
                        sendAction(AlarmReceiver.ACTION_CONFIRM, spec.occurrenceId)
                    }
                )
                actions.addView(
                    AlarmUi.pillButton(this@AlarmActivity, "Not yet", AlarmUi.ButtonStyle.GHOST, topMarginDp = 12f) {
                        showNormal()
                    }
                )
            }
            if (confirming.contains(spec.occurrenceId)) showConfirm() else showNormal()
            content.addStacked(actions)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        back.disable()
        runCatching { unregisterReceiver(dismissReceiver) }
    }

    @Deprecated("Back is intentionally inert so a ringing alarm's surface stays up; exit via Done/Snooze.")
    override fun onBackPressed() {
        // Match the system clock's alarm: Back does not dismiss a ringing alarm.
        // Done and Snooze are the only ways out (Home still leaves it ringing, with
        // the ongoing notification whose tap reopens this surface).
        //
        // API 22 to 32 only. On API 33+ the platform stops calling this once the
        // BackInterception callback is registered, which is why the empty body is not
        // enough on its own any more.
        back.handleLegacyBack()
    }

    private fun sendAction(action: String, occurrenceId: String) {
        sendBroadcast(
            Intent(this, AlarmReceiver::class.java)
                .setAction(action)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
        )
    }

    companion object {
        /** Internal broadcast: drop an occurrence from the on-screen alarm queue (or,
         * with no occurrence-id extra, close the surface outright) once it is handled. */
        const val ACTION_DISMISS = "ca.persistent.app.ALARM_ACTIVITY_DISMISS"

        /**
         * "Raise this surface, but don't move it." Set on the re-present that follows a
         * screen-on or unlock, which has to name *an* alarm to launch with but is not a
         * request for that one — see `AlarmService.screenReceiver`.
         */
        const val EXTRA_KEEP_PAGE = "keepPage"
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }
}
