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
| `occurrence.changed` | status changed (ack/snooze/escalate/miss) | invalidate active/upcoming/history occurrences + reminders |
| `reminder.changed` | a reminder was created/updated/deleted | invalidate reminders + occurrences (active/upcoming/history) |
| `dismiss` | clear a shown notification everywhere | service worker / native closes it |
| `ping` | heartbeat | ignored |

## Cross-device dismiss

When an occurrence is acknowledged or snoozed (from any device or the SW action),
the server broadcasts `dismiss` over WS **and** sends a `dismiss` push, so the
notification clears on every one of the user's devices. This is the same actor's
devices only — there is no cross-user delivery.
