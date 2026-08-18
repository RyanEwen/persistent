# Notification & alarm behavior contract

This is the source-of-truth specification for how a reminder behaves once it
fires — across the in-app UI, the web/PWA notification, the native Android
notification/alarm, and the Windows tray app's optional toast. It is intentionally
device-agnostic: every surface (in-app, service worker, native plugin, desktop
host) must converge on the same outcome.

Background model lives in [`alarm-architecture.md`](alarm-architecture.md)
(device-scheduled + server backup) and the state machine in
[`data-event-contract.md`](data-event-contract.md). This doc is the *user-facing
guarantee* those mechanisms exist to deliver.

## Vocabulary

- **Occurrence** — one firing of a reminder (`ReminderOccurrence`). A reminder
  with three times of day, or a repeating schedule, produces many occurrences.
- **Fire** — the moment an occurrence comes due and first appears. Each occurrence
  fires exactly once.
- **Nag** — the *follow-up*, not the first appearance: everything that keeps a
  fired-but-unconfirmed occurrence in front of the user afterwards (re-appearing
  when swiped away, the `PERSISTENT` nag interval, the escalation). User-facing
  copy must keep these apart — "it nags as soon as you create it" describes a first
  fire as a follow-up, which is what made the two read as the same thing.
- **Notification** — the soft nag: a notification that re-appears until confirmed
  (and, on `PERSISTENT` reminders, optionally nags again on an interval). A nag
  **presents itself again**, it doesn't just make a noise: it returns to the top of
  the shade and peeks like a newly-arrived notification. A reminder the user has to
  confirm is worth interrupting for twice, and a sound is missable — under a stack
  of newer notifications, or on a muted phone, a re-sound alone is nothing.
- **Alarm** — the hard nag: looping sound + vibration, full-screen on Android,
  not dismissable. A reminder is an alarm either because its persistence is
  `ALARM`, or because a `PERSISTENT` reminder **escalated** (after N minutes, or
  at a wall-clock time) from notification to alarm.
- **Confirm / Done / acknowledge** — the user explicitly marks the occurrence
  complete. This is the *only* thing that ends a nag for good.

**"Fire" is the model's word, not the user's.** It is the right word here, in the
schema (`firedAt`) and in the code (`fireOccurrence`, `firingOrder`), because it
names the event the whole state machine turns on. But the user never sees it: the
UI says the reminder **notifies you** — "Notifies you today at 2:50 PM", "Never
notifies you — a note", "won't notify you until you turn it on". A reminder
notifying you is the thing they actually experience; "fires" is jargon for a
concept they don't have to hold. Keep the split when adding copy — reach for
"fires" in a comment or an identifier, and "notifies you" in anything rendered.
The Nag distinction above still holds on both sides of it.

Two things hold on every surface regardless of which action the user takes:

- **Tapping the notification body opens the reminder.** A soft nag's body tap
  brings the app forward on that reminder's detail view (an *alarm's* body tap is
  the exception — it opens the full-screen control surface, so Done/Snooze stay one
  tap away once the heads-up collapses). On Android this must be a direct activity
  start; see the trampoline note in [`alarm-architecture.md`](alarm-architecture.md).
- **A multi-line description renders on multiple lines.** Details are authored in a
  multi-line textarea, so those line breaks are content: the web detail view and
  attention cards use `pre-wrap`, the native notification uses `BigTextStyle`, the
  full-screen alarm renders them as-is, and the escalation email is plain text. The
  compact list row is the one deliberate exception — it is single-line by design, so
  breaks collapse to spaces there. A checklist reminder's body is its still-unticked
  items (§1a), one per line, and depends on exactly the same thing.

The three user actions on a firing are **Done**, **Silence**, and **Snooze**.
Their guaranteed effects follow. (Silence is labeled **"De-escalate"** in the UI —
it only ever appears on an escalated alarm, and that's what it does; the internal
action/API name remains `silence`.)

## 1. Done — clears the reminder everywhere

Marking an occurrence done — from the alarm surface, the notification action, or
the in-app card, on any device — acknowledges that occurrence and **removes it
from every surface**: the alarm stops, the notification is cleared, and any
sibling escalation alarm is cancelled, on every one of the user's devices.

- Server: the occurrence becomes `ACKNOWLEDGED` (terminal) and the server
  broadcasts a `dismiss` over WebSocket **and** push (Web Push + FCM).
- Native: clears the notification and cancels both the main and `::esc`
  (escalation) on-device alarms; closes the full-screen alarm activity.
- Web/SW: closes the notification by its occurrence-id tag.

**Done is always a two-tap confirm** on every *tap* surface — the notification, the
full-screen alarm, and the in-app card (on the reminders list or a reminder's
detail view). The first tap arms the action (swapping
the controls to *Confirm done* / *Not yet*, with the alarm still ringing); only
the confirm tap acknowledges. This guards a persistence-grade reminder against a
stray pocket tap or misclick clearing it by accident. *Not yet* restores the
normal controls and changes nothing. (The Android Auto **voice** surface is the
one exception — see §5: a spoken "done" is inherently deliberate, so it
acknowledges directly.)

Done is the terminal action — it is the persistence guarantee being satisfied.

### 1a. A checklist is ticked off, but only Done confirms it

A `TODO` (Checklist) reminder carries several items, and each firing tracks which
of them it has ticked (`ReminderOccurrence.checkedItems` — per firing, so a
repeating checklist starts blank each time; see `data-event-contract.md`).

Ticking every item **does not acknowledge the occurrence.** Done remains the only
thing that clears a firing, for the same reason it is a two-tap confirm: a
checklist is ticked *while working through it*, so auto-confirming on the last tick
would let a mid-task tap end the nag. A fully-ticked list says so and points at
Done rather than acting for the user. The reverse also holds — Done works at any
point, whether or not every item is ticked; the ticks are a working aid, not a
gate. What was actually ticked survives in History.

**A notification lists only what is left.** Ticking an item removes it from the
firing's notification body — a nag is about what is still outstanding, so it does
not keep repeating work already done. The server rebuilds the body from the
firing's ticks on every surface that carries it (fire and escalate pushes, the
downgraded nag after a Silence, the on-device alarm list at
`/api/sync/occurrences`), and a tick nudges native devices to re-pull and re-post
the notification silently, so the shown text keeps up. Ticking the *last* item
leaves the reminder's title with no body — which is correct: the firing is still
unconfirmed, and only Done confirms it. A tick left behind by a since-deleted item
hides nothing.

The escalation email is the one snapshot: it lists what was unticked at the moment
it was sent, since an email cannot be revised afterwards.

**Items can be added from the card, and what they join is the definition.** Every
checklist the app draws carries an add row (`POST /api/reminders/:id/items`), so
extending a list does not mean opening the editor — the thing a list needs most
often was the thing that cost the most taps. What it adds is an *item*, and items
belong to the reminder: every later firing carries it too, and every card drawing
that checklist gains the row at once. It arrives **unticked**, so it also joins the
body of whatever is nagging right now, exactly as an item added in the editor would
— which is why the add nudges native devices to re-post, like a tick does. It
touches no ticks: adding a line to a list says nothing about what was done this
time, and it neither confirms nor excuses a firing. Only Done does that.

**The order is part of the definition too, and can be changed from the card.** Drag
handles sit on every checklist the app draws (`POST /api/reminders/:id/items/order`), so
a list can be re-ordered where it is being worked through rather than only in the
editor. It moves *items*, so the new order is the one every later firing shows and the
order the notification body lists them in — which is why it nudges devices to re-post,
exactly as adding one does. Ticks are untouched: ids are stable, so an item carries its
ticked state with it as it moves, and a reorder neither confirms nor excuses anything.
With the ticked items hidden, the rows on screen are only part of the list; the ones out
of sight keep their places relative to their neighbours rather than being flung to the
end.

**A note's checklist is the exception, and only because it cannot be a firing's.**
A note (§7) has no occurrences, so `ReminderOccurrence.checkedItems` has nothing to
hang off; its ticks live on the reminder itself (`Reminder.checkedItems`, via
`POST /api/reminders/:id/check`). That is safe here and nowhere else: the rule
above exists so a *repeating* checklist cannot inherit yesterday's ticks, and a
note never repeats because it never fires. The endpoint is restricted to notes for
that reason — two places holding "what is checked", with a firing to disagree with,
is exactly what §1a forbids. A note's list also has no "tap Done to confirm": there
is nothing to confirm.

**Hiding the ticked items is a view, and belongs to the reminder.** "Hide
checked" collapses the ticked rows out of a checklist so a long list shows only
what is left. That choice is stored (`Reminder.hideCheckedItems`, via `POST
/api/reminders/:id/hide-checked`) so a list stays the way the user left it — on
that device and on their others.

It is per *reminder* even though the ticks are per firing, and that is not a
contradiction: ticks reset each firing, so a fresh nag starts with nothing ticked
and a remembered "hidden" hides nothing until the user ticks something themselves.
The card a notification lands on therefore still shows the whole list.

Hiding changes nothing this contract guarantees. It is presentation only: the
notification body is built from the *unticked* items either way, hiding is not
ticking, and a hidden item is neither confirmed nor excused. Done still clears the
firing, and only Done.

## 2. Silence — drops the alarm back to the notification it escalated from

Silence applies only to an **escalated** alarm (a `PERSISTENT` reminder that
escalated; an inherent `ALARM` reminder has no Silence — it is meant to ring
until done). Silencing **stops the alarm but keeps the reminder nagging** as the
ordinary notification that preceded the escalation:

- The looping sound/vibration and full-screen surface stop.
- The reminder stays **`FIRED`** (unconfirmed) and continues to nag exactly as a
  pre-escalation notification would — including the `PERSISTENT` re-sound
  interval if one is set.
- It will **never escalate to an alarm again** for this firing
  (`escalationSilencedAt` suppresses both the server sweep and the on-device
  escalation alarm).
- Silence propagates to every device (WS + push `silence`): the native client
  downgrades the alarm in place; the web SW re-shows it as a plain nag.

Silence is "stop yelling, but keep reminding me." It does **not** acknowledge the
reminder — only Done does that. And the reverse holds: silencing (or snoozing) an
already-acknowledged occurrence is a **no-op** — a queued device action draining
after an ack must never resurrect a terminal occurrence back to nagging.

## 3. Snooze — snoozes the firing (the alarm), not just a notification

Snoozing temporarily clears the firing — alarm and notification both — and
re-fires it after the chosen delay. When the firing is currently an **alarm**,
snooze snoozes *that*: the alarm goes away now and **rings again** when the snooze
elapses (it does not silently degrade into a soft notification).

- Server: the occurrence becomes `SNOOZED` with `snoozedUntil`; a `dismiss`
  clears it from all devices now. When `snoozedUntil` passes, the sweep revives
  it to `FIRED` and it nags again; if its escalation threshold has already
  passed, it escalates (rings) again immediately — i.e. you snoozed the alarm.
- Native: cancels the current notification/alarm and re-arms the on-device alarm
  to fire `now + minutes`, so it still works offline. The re-armed alarm keeps the
  fidelity of the one snoozed — an escalated firing comes back **ringing**, not as a
  nag, and a snooze that outlasts a pending escalation comes back ringing too
  (`lib/device-alarms.ts` reads `escalatedAt`, not the `SNOOZED` status). Silence is
  the only thing that ends the ring for this firing.
- The escalation backstop stays anchored to the original fire, never reset by a
  snooze (escalation is a hard backstop, not a thing you can indefinitely defer
  by snoozing).

## 4. Multiple times / repeats are independent

A reminder with several times of day, or a repeating schedule, is treated as
**independent occurrences**. The system never replaces an earlier still-pending
firing with a later one:

- If the 9:00 dose is still unconfirmed when the 13:00 dose fires, **both** nag —
  two notifications (or alarms), each with its own Done / Silence / Snooze.
- Each must be confirmed **separately**. Confirming 13:00 does **not** clear 9:00;
  acking, snoozing, or silencing one occurrence affects only that occurrence.
- This holds on every surface: the in-app list (and a reminder's detail view)
  shows one attention card per pending occurrence; the web SW tags notifications
  per occurrence; the native client keys notifications and alarms per occurrence.

This is a deliberate reversal of the old "one notification per reminder"
self-collapse (`keepNewestForReminder` / the `SUPERSEDED` status), which would
let confirming a later dose silently erase an un-taken earlier one — wrong for a
medication-grade persistence app. `SUPERSEDED` is retained only as a legacy
status on historical rows and is never assigned anymore.

### 4a. Whatever fired or nagged most recently sits on top

Where several firings are shown at once, the newest is first — in the in-app list,
on a reminder's detail view (`apps/web/src/lib/firingOrder.ts`) and in the Android
shade, where a nag re-stamps its post time so it rises back up. The firing that
just arrived is the one the user is reacting to; an older one does not need to hold
the top of the list, because staying until confirmed is what the nag is *for*.

"Newest" means `ReminderOccurrence.lastNotifiedAt` — when the server last put the
firing in front of the user (the fire, a snooze revival, an escalation). It exists
because `firedAt` cannot answer that question: `firedAt` is pinned to the **first**
fire so the escalation backstop stays anchored there (§3), so a snooze that came
back an hour ago would otherwise still sort as hours old.

The one exception is an **escalation**, which outranks recency: it is ringing an
alarm right now. It is also the only firing that gets a loud card
(`firingTone.ts`), so urgency is graded the same way in both places.

## 5. Android Auto — the same actions, by voice, in the car

While the phone is projecting to Android Auto, the native notification is mirrored
into the car (as a `MessagingStyle` notification — the only form Auto surfaces).
This is a **projection of the native surface, not a new outcome**: the same three
actions apply and converge to the same server state as everywhere else.

**Only what is happening pops up.** Starting the car is not itself an event, so a nag
that was already on screen when the drive began does not announce itself in the car;
what fires, nags or rings *during* the drive does, as it happens. A ringing alarm is
the exception — it is sounding right now, so it appears the moment the car connects.
Nothing about this changes the guarantee: an unannounced nag is still `FIRED` and
still nagging on the phone, and it is listed in full on the car screen (§5b).

**Android Auto is the sideloaded build only.** Both halves of it — the notification
mirror here and the car screen in §5b — ship in the `direct` APK and not in the Play one.
Declaring the mirror (`<uses name="notification"/>`) tells Auto the app sends and receives
messages, and Play's Auto review holds it to that; a reminder app cannot pass a messaging
test, so the Play build opts out of Auto entirely rather than claim to be something it is
not (`alarm-architecture.md`, `store/play-readiness.md` #1b). Nothing about the guarantee
changes for a Play user: the phone still nags, rings and escalates exactly as specified —
it simply does not project into the car.

Because Auto offers no arbitrary buttons on a notification, the user acts on one by
**voice reply**:

- "done" / "finished" / "all done" → **Done** (acknowledges). This is the one place
  Done is *not* a two-tap confirm — a spoken Done is inherently deliberate and there
  is no pocket-tap to guard against.
- "snooze 15 minutes" / "in an hour" → **Snooze** for the parsed duration (default
  10 minutes if none is spoken).
- "de-escalate" / "silence" → **Silence**, but only when the occurrence is actually
  ringing as an escalated alarm (otherwise ignored).
- An unrecognized reply is ignored — the nag persists.

Auto's **mark-as-read** action (and reading the reminder aloud) **never**
acknowledges — only an explicit spoken Done does; the persistence guarantee holds in
the car exactly as on every other surface. A continuously-looping alarm tone is not
an Auto capability, so in-car an alarm is an urgent messaging heads-up (Auto's chime
+ read-aloud) while the real looping alarm keeps ringing on the phone. See
[`alarm-architecture.md`](alarm-architecture.md) (Android Auto) for the mechanism.

## 5b. The Android Auto screen — the list, at the driver's pace

The sideloaded build also carries a car screen listing everything the device knows
about: what is nagging now under **Needs attention**, the week ahead under **Coming
up**, and the kept **Notes** last. It is the counterpart to the rule above —
notifications carry what is happening, this carries everything else — and it is why a
standing nag can stay quiet when the car starts without becoming lost.

The week and the notes are more than the device *arms*: the alarm set is everything due
plus 48 hours, because each entry is an exact alarm the OS holds. So the same sync also
returns a read-only **agenda** (`deviceAgendaEntrySchema`) covering seven days plus the
notes, stored apart from the alarm set so nothing in it can ring, and merged in at read
time with the alarm set winning wherever both describe the same firing. Head units cap
how many rows a list may carry — as few as six while driving — so the screen **pages**:
each fills to the cap and hands the rest to another copy of itself behind a row saying
how many are behind it. Truncating with a "+N not shown" note was the old behavior, and
a count of things you cannot reach is not a list.

**Opening the app on the head unit shows the backlog as notifications too.** Connecting
stays quiet — projecting is not a request — but opening Persistent in the car is an
explicit one, so every unconfirmed nag gains its car form at that moment and lands in
the car's own notification list, where it can be read aloud and answered by voice (§5).
The request expires with the drive: a later connection is quiet again.

Opening a reminder there shows its full body (its **unticked** items, as everywhere)
and offers **Done** and **Snooze**, plus **De-escalate** when an escalation is actually
ringing. Same three actions, same server state, same guarantee: only Done clears a
firing. Done sits one screen in from the list rather than on the list itself — the
deliberateness the phone gets from its two-tap confirm, without asking a driver to
read a confirmation. A reminder that has not fired yet offers no actions, exactly as
it has no notification to act on.

The Play build ships neither this screen (Android Auto has no app category a reminder app
can honestly claim) nor the notification mirror of §5 — it carries no Android Auto
integration at all.

## 5a. Windows tray app — the same actions, on a toast

The Windows tray app (`apps/desktop`) can optionally raise a Windows toast when an
occurrence fires. Like Android Auto it is a **projection of the same outcome, not a
new one** — but unlike Auto it is explicitly *not* a guarantee: it appears only
while that PC is awake with the app running, it never rings an alarm and it never
wakes the machine. It is off by default and says all of this in its own settings
copy. The Android client remains the only surface that guarantees anything.

Within that limit it holds the contract:

- **One toast per occurrence**, never per reminder (§4). Toasts are tagged by
  occurrence id, so an unconfirmed 09:00 dose is not replaced by the 13:00 one.
- **Done is still a two-tap confirm** (§1). A toast button cannot ask a question,
  so the first Done replaces the toast with a "Mark this done?" variant carrying
  Confirm / Not yet; only Confirm acknowledges, and Not yet restores the original
  and changes nothing. This is the *mechanism* differing, not the rule.
- **Snooze** offers the same durations as every other surface (5 min → 1 day,
  mirroring `SNOOZE_PRESETS`) in a picker on the toast itself; the app setting only
  chooses which one starts selected. A single fixed duration hidden in settings is
  not the same feature — snoozing is a choice about when to be asked again.
- **Body tap opens the reminder**, as on every other soft-nag surface.
- **A `dismiss` from any device clears it**, so confirming on the phone removes the
  desktop toast.
- **Silence does not appear.** It drops an escalated alarm back to a notification,
  and there is no alarm on this surface.
- **A rejected action leaves the toast up.** The server decides whether an ack or
  snooze is allowed (a 409 on a terminal occurrence); a refusal is reported rather
  than papered over, because clearing the toast would claim something was done.

The toast shows the reminder's title and its `details`, but **not** a medication's
doses or a checklist's items: rendering those is `reminderBodyText` in
`@persistent/shared`, and the host deliberately holds no copy of it. See
[`desktop-architecture.md`](desktop-architecture.md).

> Consequence to keep in mind: a reminder a user ignores across several scheduled
> times will accumulate one pending occurrence per missed time (each must be
> cleared). That is intended — the app's job is to not let any single firing be
> forgotten. The smallest repeat granularity is per-time-of-day (there is no
> sub-hour auto-repeat), so this does not produce runaway stacks; within a single
> firing, re-nagging is the re-sound interval, not new occurrences.

## 6. Editing a reminder never silently clears an unconfirmed firing

Rescheduling is not a way to make a nag go away. Editing a reminder drops its
not-yet-fired (`PENDING`) occurrences and re-materializes from the new schedule,
but an occurrence that has already **fired and not been confirmed survives the
edit** — §1 still holds, and only Done ends it. A reminder whose 09:00 dose is
unconfirmed keeps nagging about that dose even if you retime it to 10:00.

The visible consequence: move a reminder's start date into the future while an
earlier firing is unconfirmed, and that firing keeps nagging against a schedule
that no longer contains its date. That is intended, but "Due" describes it badly —
the reminder now claims to start next week, yet something is due today. So the UI
tells the two apart (`isOutsideReminderWindow`, `apps/web/src/lib/occurrenceSchedule.ts`):
a firing whose date falls outside the reminder's current start/end window is
labelled **Unconfirmed** rather than Due, carries a line explaining it fired before
the reschedule, and offers **Clear** in place of Done. It still takes the same
two-tap confirm and the same acknowledge — only the wording changes, because
calling it "Done" would claim the user completed something the reminder has moved
on from.

An **unscheduled** reminder's firing (kind `none`) has the same problem — it
happened because the user asked to be reminded, not because a time arrived, so
"Due" claims a deadline that never existed. It is handled the opposite way,
though: it gets **no status chip at all** (`FiringStatusChip` returns nothing).
An unscheduled firing has no second state to be in — it is either nagging, which
the card's own Done/Snooze already say, or confirmed and gone — so a chip there
is a constant, and labelling it "Unconfirmed" reads as a warning about a reminder
doing exactly what was asked. It keeps **Done** (not Clear): the user did ask for
it, so there is something to have done. A snoozed or escalated unscheduled firing
still shows its real status chip; only the `FIRED` case is the constant.

Unscheduled and orphaned never overlap: an unscheduled reminder is excluded from the orphan test
outright, because its `startDate` is a bare record of when it was last saved, not
a window a firing can fall outside of. Comparing against it anyway is how a
reminder that had *just* been made unscheduled described its brand-new firing as
a leftover from before a reschedule, and offered Clear for something the user had
only asked for a moment earlier.

Urgency in the UI is graded to match: only an **escalated** firing gets a filled,
loud card. An ordinary due reminder is outlined, and the orphaned and unscheduled
cases are quieter still (`apps/web/src/lib/firingTone.ts`, shared by the list and
the detail view). None of this changes what the firing *is* — every one of them
still nags until confirmed; only how hard it shouts.

The comparison is deliberately by **date, not time of day**: retiming a reminder
whose dose is still unconfirmed must keep that dose nagging, because the day it
belongs to is still covered.

**The first exception** is a reminder that had no schedule at all (kind `none` —
see the root `CLAUDE.md`). Its single firing is an artifact of being unscheduled,
not a commitment to a date, so giving it a real schedule retires that firing
instead of leaving it behind.

**The second is turning a reminder into a note** (kind `never` — a reminder that
never fires; see §7). Here the firings *were* real, and they are still retired —
dropped and dismissed on every device, exactly as deleting the reminder does. The
user has said this thing does not remind, and a nag left behind would contradict
the mode they just chose, on a card whose own reminder now reads "Never fires".
Every other reschedule can point at a later firing to carry the obligation
forward to; this one cannot, because there is no later firing. Done is still
available right up until the edit, and what was already confirmed stays in
History.

Going the other way — **taking a reminder's schedule away** — is not an exception:
whatever its schedule left unconfirmed keeps nagging, because those firings were
real. It follows that the reminder does *not* also get the "remind me about this"
firing an unscheduled reminder normally gets; it is already in front of the user,
and a second one would be indistinguishable from the first, since an unscheduled
firing has no time of day to tell them apart. The immediate firing appears only
when nothing is left nagging.

## 7. A note opts out of all of it

A reminder whose schedule kind is **`never`** is a **note**: something kept in the
app to read, not to be reminded of. It is the one reminder this entire contract
does not apply to, because it never produces an occurrence — and every guarantee
above is a guarantee about an occurrence.

- It **never fires**, so it never nags, never escalates, never emails a contact,
  and never needs confirming. There is nothing to Done, Silence or Snooze.
- It therefore **never appears as a firing** — no attention card, no notification,
  nothing in any shade on any device. Notes are listed all the same, on a **tab of
  their own** that the bar offers only while at least one note exists: a note is
  opt-in, and an empty tab would spend a fifth of a phone's nav bar on a feature the
  account doesn't use. They sat at the foot of Current until there were enough of them
  to be in the way — Current answers "is anything waiting on me?", and nothing on this
  list ever is. In the car they are listed too, in their own section and with nothing
  to act on (§5b).
- Materialization deliberately expands nothing for it, exactly as for `none`
  (`isTimeless`) — so no timer can start it firing later.
- Escalation is rejected at the boundary rather than stored and ignored: a note
  cannot be escalated to an alarm or emailed to a nominated contact, because
  nothing about it can ever go unanswered.
- It is a note, not a *type* — a `TODO` note is a kept checklist, a `MEDICATION`
  note is a dose reference. Its checklist is ticked and extended like any other; the
  ticks just live on the reminder, since there is no firing for them to belong to
  (§1a).

Pausing (`active: false`) is not the same thing and does not overlap: a paused
reminder is one that *would* fire, held; a note is one that would not. That is why
the editor tells a note "Never fires — kept as a note" rather than offering
"won't fire until you turn it on", which a note would never honour.

Notes are reachable in both directions. Giving a note a real schedule (or "Remind
me now") makes it an ordinary reminder from that moment, and the settings it kept
while it was a note — the repeat, the escalation — come back with it. Turning a
firing reminder into a note retires whatever it left nagging (§6).
