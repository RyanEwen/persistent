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
| `occurrence.fired` | an occurrence became due | invalidate active/upcoming/history occurrences + reminders (the list shows each reminder's latest-occurrence status) |
| `occurrence.changed` | status changed (ack/snooze/escalate) | invalidate active/upcoming/history occurrences + reminders |
| `reminder.changed` | a reminder was created/updated/deleted | invalidate reminders + occurrences (active/upcoming/history) |
| `dismiss` | clear a shown notification everywhere | service worker / native closes it |
| `silence` | stop an escalation alarm but keep nagging | SW re-shows as a soft nag; native downgrades the alarm |
| `ping` | heartbeat | ignored |

## Cross-device dismiss

When an occurrence is acknowledged or snoozed (from any device or the SW action),
the server broadcasts `dismiss` over WS **and** sends a `dismiss` push, so the
notification clears on every one of the user's devices. This is the same actor's
devices only — there is no cross-user delivery. Each occurrence is independent, so
a `dismiss` only ever clears the one occurrence that was acked/snoozed — a
reminder's other still-unconfirmed firings keep nagging on their own.

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

## Native sync nudge

Reminder create/update/delete has no self-contained fire/dismiss payload, but a
device still needs to re-derive what it should schedule/show (a renamed reminder, a
changed schedule, a deletion). Alongside the `reminder.changed` WS broadcast, the
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
