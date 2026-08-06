# Data + event contract

How data loads and how live updates flow. Mirrors printstream's model, scoped
per-user instead of per-tenant.

## Loading

All data loads over guarded HTTP via `apiFetch` (`apps/web/src/lib/apiClient.ts`)
wrapped in TanStack Query hooks (`apps/web/src/data/`). Responses match the Zod
schemas in `@persistent/shared`.

The query cache is persisted to localStorage (`apps/web/src/lib/persistQuery.ts`)
so reminders/occurrences render offline; reminder writes apply optimistically and
queue while offline, replaying on reconnect via mutation defaults registered in
`lib/queryClient.ts` (`resumePausedMutations`). Auth/push queries are excluded
from persistence.

**History pages; the other feeds don't.** `GET /api/occurrences?scope=history`
returns `{ occurrences, nextCursor }` (`occurrenceListSchema`) and takes a
`?cursor=<occurrenceId>`; the client walks it with `useInfiniteQuery` behind a
"Show more" button. It is the only feed that grows without bound — nothing prunes
acknowledged occurrences, so a daily reminder adds ~365 rows a year and each
carries a denormalized copy of its reminder — whereas active ("what is nagging")
and upcoming ("what is next") are small by construction and still return whole
with `nextCursor: null`.

The page query orders by `[scheduledFor desc, id desc]`, a **total** order. One
reminder cannot have two firings at the same instant
(`@@unique([reminderId, scheduledFor])`), but different reminders routinely share
one — everything set to 09:00 fires together — and history spans all of them, so
without the id tiebreak a cursor landing inside a tie would skip or repeat those
rows. A cursor whose occurrence no longer exists (its reminder was deleted
mid-paging) returns an empty page rather than erroring, which the client reads as
"no more".

Conflict resolution is **last-edit-wins**: an update sends `clientEditedAt` (the
wall time the edit was made, captured at submit so it survives offline queueing).
The PUT route ignores a write whose `clientEditedAt` predates the stored row's
`updatedAt` (`lib/conflict.ts`), so a late-replayed stale edit can't clobber a
newer one; the stale client reconciles on its next refetch. Creates always apply
(new id, no conflict).

## Live updates (WebSocket `/ws`)

One reconnecting socket per signed-in client (`apps/web/src/lib/wsClient.ts`),
authenticated by the session cookie at upgrade and bound to the user on the
server (`apps/api/src/lib/ws-hub.ts`). The server fans events to all of that
user's sockets with `broadcast(userId, event)`.

**Events are invalidation hints, not data and not auth proof.** The client maps
each event to TanStack Query cache invalidations; sensitive data is then
re-fetched over guarded HTTP. Never trust an event payload as authorization, and
never poll in components.

Event types (`packages/shared/src/ws-events.ts`):

| Event | Meaning | Client reaction |
|---|---|---|
| `occurrence.fired` | an occurrence became due | invalidate active/upcoming/history occurrences + reminders (a one-time reminder drops off the list once its latest occurrence is acknowledged) |
| `occurrence.changed` | status changed (ack/snooze/escalate) | invalidate active/upcoming/history occurrences + reminders |
| `reminder.changed` | a reminder was created/updated/deleted | invalidate reminders + occurrences (active/upcoming/history) |
| `dismiss` | clear a shown notification everywhere | service worker / native closes it |
| `silence` | stop an escalation alarm but keep nagging | SW re-shows as a soft nag; native downgrades the alarm |
| `ping` | heartbeat | ignored |

The web client is not the only consumer. The Windows tray app opens its **own**
`/ws` connection when its optional notifications are turned on, because the page
it hosts is suspended while the flyout is hidden — see
[`desktop-architecture.md`](desktop-architecture.md). It reads a deliberately tiny
slice (an occurrence's id, reminder id, status, title and `details`) and ignores
every other field and event type, so events stay free to grow.

## Cross-device dismiss

When an occurrence is acknowledged or snoozed (from any device or the SW action),
the server broadcasts `dismiss` over WS **and** sends a `dismiss` push, so the
notification clears on every one of the user's devices. This is the same actor's
devices only — there is no cross-user delivery. Each occurrence is independent, so
a `dismiss` only ever clears the one occurrence that was acked/snoozed — a
reminder's other still-unconfirmed firings keep nagging on their own.

Three server-side paths emit `dismiss` without the user acting on the occurrence
itself: deleting a reminder (its active occurrences are cleared from every device
after the cascade), giving a real schedule to a previously **unscheduled**
reminder (schedule kind `none`), which retires the single firing it got for being
unscheduled, and turning a reminder into a **note** (schedule kind `never`), which
retires every live firing because the reminder no longer reminds. All three
broadcast over WS and push `dismiss` per occurrence, exactly as an ack does. See
`docs/notification-behavior.md` §6 for why rescheduling is otherwise never allowed
to clear an unconfirmed firing, and §7 for what a note is.

The reverse edit — taking a reminder's schedule away — emits nothing: its
unconfirmed firings are real and stay put, and the unscheduled firing is minted
only when none of them are (`ensureUnscheduledFiring`), so there is never a
second, indistinguishable card for the same reminder.

`POST /api/occurrences/:id/ack` only applies to a *nagging* occurrence. Allowed
when the occurrence is `FIRED`/`SNOOZED`/`ESCALATED`, or `PENDING` but already
**due** (`scheduledFor <= now` — the native on-device alarm can fire up to one
tick before the server flips it to `FIRED`). Re-acking an already-`ACKNOWLEDGED`
one is an idempotent no-op (safe for offline-queue / native pending-ack drains and
retries). Acking a **not-yet-due** `PENDING` occurrence, or a terminal one
(`SUPERSEDED`/`MISSED`), is rejected with `409`. This guard is load-bearing:
marking a future `PENDING` occurrence `ACKNOWLEDGED` before its fire time would
silently cancel the firing on every channel (the tick only fires `PENDING`;
`/api/sync/occurrences` stops shipping it, so the on-device alarm is cancelled on
the next sync). See `apps/api/src/lib/occurrence-ack.ts`.

## Cross-device silence

Silencing an **escalation** alarm (`POST /api/occurrences/:id/silence`) is *not* a
dismiss: the occurrence stays `FIRED` and keeps nagging — only the loud alarm
stops, and it never escalates again (`escalationSilencedAt` suppresses the sweep
and the on-device escalation alarm). The server reverts `ESCALATED → FIRED`, then
broadcasts a `silence` WS event **and** sends a `silence` push so every device
downgrades its ringing alarm to a soft notification instead of clearing it.

## Checklist ticks

A `TODO` reminder's items live on the reminder (`typeData.items`, each with a
stable client-minted id); the *ticked* ids live per firing, on the occurrence
(`ReminderOccurrence.checkedItems`). A repeating checklist therefore starts every
firing blank — yesterday's ticks say nothing about today's.

A **note** (schedule kind `never`) has no occurrence, so its ticks go on the
reminder — `Reminder.checkedItems`, via `POST /api/reminders/:id/check`, which
takes the same `{ itemId, checked }` body and is rejected for anything that is not
a `TODO` note. It broadcasts `reminder.changed` (WS only: a note notifies nobody,
so there is no push to send and nothing on-device to re-sync). The column is
cleared whenever the reminder stops being a note.

`POST /api/occurrences/:id/check` takes `{ itemId, checked }` — one item at a
time, deliberately, rather than "here is the whole checked set": these mutations
queue offline and replay later, and a whole-set write would let a stale replay
wipe ticks made in the meantime. Each toggle is idempotent, so a replayed
duplicate is a no-op. It applies only to a *nagging* occurrence
(`FIRED`/`SNOOZED`/`ESCALATED`) — same guard as silence/snooze, so a toggle drained
after the ack can't rewrite a finished firing's record.

Ticking every item **does not acknowledge** the occurrence — only Done clears a
firing (`notification-behavior.md` §1). The server broadcasts `occurrence.changed`
over WS **and** sends a sync nudge: the notification body is only the *unticked*
items, so a tick changes the text of an already-armed alarm. Native devices re-pull
`/api/sync/occurrences` and re-post the nag silently (`alertOnce`, so a refreshed
body never re-alerts); web clients converge over the WS event, which is why there
is still no push. The web client applies the toggle optimistically
(`mutationKeys.checkOccurrenceItem`) — a checkbox that waits for a round trip feels
broken.

## Hiding ticked checklist items

Whether a checklist is drawn with its ticked items collapsed is stored on the
reminder (`Reminder.hideCheckedItems`) and set by `POST
/api/reminders/:id/hide-checked`, which takes `{ hidden }` and is rejected for
anything that is not a `TODO`. It exists as stored state for one reason: so a
list left collapsed on one device is still collapsed on the next.

It is the one **display** preference that is server-synced. The rest (time
format, theme, chosen sounds, the default shade prominence) are deliberately
per-device in the web client's localStorage — they describe a device, whereas
this describes one *list*.

Whole state (`{ hidden }`) rather than a toggle, unlike a tick: there is a single
flag, so a stale replay can only restore a view the user themselves chose, while
"toggle" replayed twice would land on the opposite of what they asked for.

`reminder.changed` over WS, and **no** push and **no** sync nudge — unlike a
tick. Notification text is built from the *unticked* items either way, so no
armed alarm goes stale because someone collapsed a list, and nothing about the
done/nag guarantee is affected. Applied optimistically on the web
(`mutationKeys.hideCheckedItems`), like the tick it sits beside.

Deliberately not part of `PUT /api/reminders/:id`: that endpoint replaces the
whole definition from the editor form, and this is set by a button on a card the
editor never shows — routing it through the form would make every collapse a
full-definition write racing a real edit from another device. So the update path
leaves the column alone, and nothing clears it: the worst a leftover can do is
collapse a list the user themselves collapsed, and only once something is ticked
again.

## Native sync nudge

Reminder create/update/delete has no self-contained fire/dismiss payload, but a
device still needs to re-derive what it should schedule/show (a renamed reminder, a
changed schedule, a deletion) — as does a checklist tick, which rewrites a live
notification's body. Alongside the `reminder.changed` WS broadcast, the
server sends an **FCM-only** `sync` push (`nudgeNativeSync`) so a native device with
a live bridge resyncs promptly. It is deliberately not sent over Web Push (a push
that shows no notification makes browsers surface a generic "site updated" one) —
open web clients already converge over `/ws`. A fully-closed device can't act on the
`sync` push itself (that resync needs the WebView's session), but it no longer has to
wait for its next open: the native `SyncWorker` re-pulls and reconciles autonomously
(~15 min + on connectivity, authenticating with the WebView cookie — see
`docs/alarm-architecture.md`). So the `sync` push and the fire/dismiss pushes are
just insurance that shortens the catch-up window; the background worker is the
closed-app backstop.
