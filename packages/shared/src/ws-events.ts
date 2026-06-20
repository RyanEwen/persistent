/**
 * WebSocket event contract for the single per-user `/ws` channel.
 *
 * Events are invalidation hints, not auth proof — the web client uses them to
 * refresh TanStack Query caches (never poll). Sensitive data still loads over
 * guarded HTTP. See docs/data-event-contract.md.
 */
import { z } from 'zod'
import { occurrenceSchema } from './reminders.js'

export const wsEventSchema = z.discriminatedUnion('type', [
  // An occurrence became due and was fired by the scheduler.
  z.object({ type: z.literal('occurrence.fired'), occurrence: occurrenceSchema }),
  // An occurrence changed status (acknowledged, snoozed, escalated, missed).
  z.object({ type: z.literal('occurrence.changed'), occurrence: occurrenceSchema }),
  // A reminder definition was created/updated/deleted — refetch the list.
  z.object({ type: z.literal('reminder.changed'), reminderId: z.string().nullable() }),
  // Clear a shown notification across all of this user's open clients.
  z.object({ type: z.literal('dismiss'), occurrenceId: z.string() }),
  // Heartbeat to keep proxies from closing idle sockets.
  z.object({ type: z.literal('ping') })
])
export type WsEvent = z.infer<typeof wsEventSchema>
