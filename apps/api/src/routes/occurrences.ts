/**
 * Occurrence routes: the "due now / needs confirmation" feed plus the explicit
 * completion (ack), snooze, silence, and checklist-item actions.
 *
 * Acknowledging or snoozing broadcasts a `dismiss` (over WS and push) so the
 * notification clears on every one of the user's devices — the cross-device
 * dismiss sync that backs the "device-scheduled + server backup" model.
 * Silencing an escalation instead broadcasts a `silence`: it stops the alarm but
 * keeps the occurrence FIRED/nagging, and suppresses any further escalation.
 */
import { Router } from 'express'
import type { ReminderOccurrence } from '@prisma/client'
import {
  checkItemInputSchema,
  snoozeInputSchema,
  todoItems,
  type OccurrenceStatus,
  type TypeData
} from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, conflict, notFound } from '../lib/http-error.js'
import { toOccurrence, toCheckedItemIds } from '../lib/serializers.js'
import { broadcast } from '../lib/realtime.js'
import { dispatchToUser, nudgeNativeSync } from '../lib/delivery/index.js'
import { notificationTitle, notificationBody } from '../lib/notification-format.js'
import { ackDecision } from '../lib/occurrence-ack.js'
import { logger } from '../lib/logger.js'

export const occurrencesRouter = Router()
occurrencesRouter.use(requireUser)

/** Statuses that still need user attention. */
const ACTIVE_STATUSES: OccurrenceStatus[] = ['FIRED', 'ESCALATED', 'SNOOZED']
/** Past entries: handled, expired, or auto-resolved by a newer firing. */
const HISTORY_STATUSES: OccurrenceStatus[] = ['ACKNOWLEDGED', 'MISSED', 'SUPERSEDED']

/**
 * History is the only feed that grows without bound — nothing prunes acknowledged
 * occurrences, so a daily reminder adds 365 rows a year and a three-dose
 * medication ~1,100, each carrying a denormalized copy of its reminder. Active and
 * upcoming answer "what is nagging" and "what is next", which are small by
 * construction, so they still return whole.
 */
const HISTORY_PAGE_SIZE = 50

// GET /api/occurrences?scope=active|upcoming|history[&cursor=<occurrenceId>]
occurrencesRouter.get('/', async (request, response) => {
  const userId = requireUserId(request)
  const scope =
    request.query.scope === 'upcoming' ? 'upcoming' : request.query.scope === 'history' ? 'history' : 'active'

  if (scope === 'history') {
    const cursor =
      typeof request.query.cursor === 'string' && request.query.cursor.length > 0 ? request.query.cursor : undefined

    const rows = await prisma.reminderOccurrence.findMany({
      where: { userId, status: { in: HISTORY_STATUSES } },
      include: { reminder: true },
      // A *total* ordering, deliberately. One reminder can't have two firings at
      // the same instant (@@unique([reminderId, scheduledFor])), but *different*
      // reminders routinely share one — every reminder set to 09:00 fires
      // together — and history spans all of them. A cursor into a partially
      // ordered set silently skips or repeats the rows sharing the boundary
      // value, so the id tiebreak is what makes each page exact.
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
      // One extra row answers "is there another page?" without a second count
      // query; it is sliced off before serializing.
      take: HISTORY_PAGE_SIZE + 1,
      // `skip: 1` steps past the cursor row itself — the client already has it.
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    })

    const hasMore = rows.length > HISTORY_PAGE_SIZE
    const page = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows
    response.json({
      occurrences: page.map(toOccurrence),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null
    })
    return
  }

  const where =
    scope === 'upcoming'
      ? { userId, status: 'PENDING' as OccurrenceStatus }
      : { userId, status: { in: ACTIVE_STATUSES } }

  const occurrences = await prisma.reminderOccurrence.findMany({
    where,
    include: { reminder: true },
    orderBy: { scheduledFor: scope === 'upcoming' ? 'asc' : 'desc' },
    take: scope === 'upcoming' ? 100 : 200
  })
  response.json({ occurrences: occurrences.map(toOccurrence), nextCursor: null })
})

occurrencesRouter.post('/:id/ack', async (request, response) => {
  const userId = requireUserId(request)
  const existing = await prisma.reminderOccurrence.findFirst({
    where: { id: request.params.id, userId },
    include: { reminder: true }
  })
  if (!existing) throw notFound('Occurrence not found.')

  // An ack confirms a *nagging* occurrence is done; acking one that is not yet
  // due would silently cancel its firing (the tick only fires PENDING). Log every
  // ack with its prior status + client so a premature ack is traceable.
  const now = new Date()
  const decision = ackDecision(existing.status, existing.scheduledFor, now)
  logger.info('occurrence ack', {
    occurrenceId: existing.id,
    reminderId: existing.reminderId,
    priorStatus: existing.status,
    decision,
    userAgent: request.get('user-agent') ?? undefined
  })

  if (decision === 'reject') {
    throw conflict(`Cannot acknowledge a ${existing.status} occurrence.`)
  }
  if (decision === 'noop') {
    // Idempotent retry: already acknowledged and already dismissed everywhere.
    response.json({ occurrence: toOccurrence(existing) })
    return
  }

  const updated = await prisma.reminderOccurrence.update({
    where: { id: existing.id },
    data: {
      status: 'ACKNOWLEDGED',
      acknowledgedAt: now,
      // A due PENDING ack (native alarm beat the server tick) never got a firedAt;
      // stamp it from scheduledFor so history/escalation anchors stay coherent.
      ...(existing.firedAt ? {} : { firedAt: existing.scheduledFor })
    },
    include: { reminder: true }
  })

  await dismissEverywhere(userId, updated.id)
  broadcast(userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
  response.json({ occurrence: toOccurrence(updated) })
})

occurrencesRouter.post('/:id/snooze', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = snoozeInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid snooze duration.')

  const existing = await prisma.reminderOccurrence.findFirst({
    where: { id: request.params.id, userId },
    include: { reminder: true }
  })
  if (!existing) throw notFound('Occurrence not found.')

  // Only a nagging occurrence can be snoozed — a queued device snooze draining
  // after an ack must not resurrect a terminal occurrence (same guard as silence).
  if (existing.status !== 'FIRED' && existing.status !== 'ESCALATED' && existing.status !== 'SNOOZED') {
    response.json({ occurrence: toOccurrence(existing) })
    return
  }

  const snoozedUntil = new Date(Date.now() + parsed.data.minutes * 60_000)
  const updated = await prisma.reminderOccurrence.update({
    where: { id: existing.id },
    data: { status: 'SNOOZED', snoozedUntil },
    include: { reminder: true }
  })

  await dismissEverywhere(userId, updated.id)
  broadcast(userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
  response.json({ occurrence: toOccurrence(updated) })
})

// Tick / untick one checklist item on one firing (TODO reminders). The checked set
// belongs to the occurrence, not the reminder, so a repeating checklist starts each
// firing blank.
//
// This deliberately does NOT acknowledge the occurrence when the last item is
// ticked: only Done clears a firing (docs/notification-behavior.md §1a), and a
// checklist you tick as you go would otherwise silently confirm itself mid-task.
occurrencesRouter.post('/:id/check', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = checkItemInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid checklist item.')

  const existing = await prisma.reminderOccurrence.findFirst({
    where: { id: request.params.id, userId },
    include: { reminder: true }
  })
  if (!existing) throw notFound('Occurrence not found.')
  if (existing.reminder.type !== 'TODO') throw badRequest('This reminder has no checklist.')

  const items = todoItems((existing.reminder.typeData ?? {}) as TypeData)
  if (!items.some((item) => item.id === parsed.data.itemId)) throw notFound('Checklist item not found.')

  // Only a nagging firing has a checklist to work through. Same guard as
  // silence/snooze: a toggle queued on a device and drained after the ack must not
  // rewrite a finished firing's record of what was actually done.
  if (existing.status !== 'FIRED' && existing.status !== 'ESCALATED' && existing.status !== 'SNOOZED') {
    response.json({ occurrence: toOccurrence(existing) })
    return
  }

  // Applied as ONE atomic statement rather than the obvious read-modify-write,
  // which loses a tick whenever two arrive together — and they do: working down a
  // checklist means tapping several items in quick succession, and each tap is its
  // own request. Read-modify-write has both read `[]` before either write lands, so
  // the second overwrites the first.
  //
  // `-` removes every matching element (so re-ticking can't duplicate, making the
  // toggle idempotent for offline replays) and `||` appends. Raw SQL is confined to
  // the checklist writes that need this atomicity (the two in `routes/reminders.ts`
  // are the others); the tagged template parameterizes, and `userId` still scopes it.
  const { itemId, checked } = parsed.data
  await prisma.$executeRaw`
    UPDATE "ReminderOccurrence"
    SET "checkedItems" = CASE
      WHEN ${checked}::boolean THEN ("checkedItems" - ${itemId}::text) || jsonb_build_array(${itemId}::text)
      ELSE "checkedItems" - ${itemId}::text
    END
    WHERE "id" = ${existing.id} AND "userId" = ${userId}
  `
  const updated = await prisma.reminderOccurrence.findFirstOrThrow({
    where: { id: existing.id, userId },
    include: { reminder: true }
  })

  // A notification lists only the items still unticked, so this tick changed its
  // text. Web clients converge over WS; native devices need the FCM-only `sync` to
  // re-pull and re-post the nag (silently — `ensureNags` re-posts on text drift
  // with `alertOnce`, so refreshing the list never re-alerts).
  // Not awaited: working down a checklist is a burst of taps, and none of them
  // should wait on an FCM round trip to answer.
  broadcast(userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
  void nudgeNativeSync(userId).catch((error) =>
    logger.warn('checklist sync nudge failed', { error: String(error), occurrenceId: updated.id })
  )
  response.json({ occurrence: toOccurrence(updated) })
})

// Silence an escalation alarm: stop the alarm but keep the occurrence FIRED so it
// keeps nagging (and never escalates again — escalationSilencedAt suppresses the
// sweep and the on-device escalation alarm). Unlike ack/snooze this does NOT
// dismiss the notification; it downgrades it across every device.
occurrencesRouter.post('/:id/silence', async (request, response) => {
  const userId = requireUserId(request)
  const existing = await prisma.reminderOccurrence.findFirst({
    where: { id: request.params.id, userId },
    include: { reminder: true }
  })
  if (!existing) throw notFound('Occurrence not found.')

  // Silence only means something for a nagging occurrence. It must NEVER touch a
  // terminal one: a device can queue a silence and an ack for the same occurrence
  // and drain them in one batch — without this guard the trailing silence flipped
  // the just-ACKNOWLEDGED occurrence back to FIRED, resurrecting a done reminder.
  if (existing.status !== 'FIRED' && existing.status !== 'ESCALATED' && existing.status !== 'SNOOZED') {
    response.json({ occurrence: toOccurrence(existing) })
    return
  }

  const updated = await prisma.reminderOccurrence.update({
    where: { id: existing.id },
    // Back to FIRED (still nagging); keep firedAt as the original anchor. The
    // silenced stamp is what stops re-escalation, not the status.
    data: { status: 'FIRED', escalationSilencedAt: existing.escalationSilencedAt ?? new Date(), snoozedUntil: null },
    include: { reminder: true }
  })

  await silenceEverywhere(userId, updated)
  broadcast(userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
  response.json({ occurrence: toOccurrence(updated) })
})

async function dismissEverywhere(userId: string, occurrenceId: string): Promise<void> {
  broadcast(userId, { type: 'dismiss', occurrenceId })
  await dispatchToUser(userId, { type: 'dismiss', occurrenceId })
}

/**
 * Tell every device to stop the alarm but keep the soft nag for this occurrence.
 * The downgraded nag carries the firing's own text, so a checklist still lists
 * only what is unticked.
 */
async function silenceEverywhere(
  userId: string,
  occurrence: ReminderOccurrence & { reminder: Parameters<typeof notificationTitle>[0] & Parameters<typeof notificationBody>[0] }
): Promise<void> {
  broadcast(userId, { type: 'silence', occurrenceId: occurrence.id })
  await dispatchToUser(userId, {
    type: 'silence',
    occurrenceId: occurrence.id,
    title: notificationTitle(occurrence.reminder),
    body: notificationBody(occurrence.reminder, toCheckedItemIds(occurrence.checkedItems)),
    alarm: false
  })
}
