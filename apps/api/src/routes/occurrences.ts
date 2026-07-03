/**
 * Occurrence routes: the "due now / needs confirmation" feed plus the explicit
 * completion (ack), snooze, and silence actions.
 *
 * Acknowledging or snoozing broadcasts a `dismiss` (over WS and push) so the
 * notification clears on every one of the user's devices — the cross-device
 * dismiss sync that backs the "device-scheduled + server backup" model.
 * Silencing an escalation instead broadcasts a `silence`: it stops the alarm but
 * keeps the occurrence FIRED/nagging, and suppresses any further escalation.
 */
import { Router } from 'express'
import { snoozeInputSchema, type OccurrenceStatus } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, conflict, notFound } from '../lib/http-error.js'
import { toOccurrence } from '../lib/serializers.js'
import { broadcast } from '../lib/realtime.js'
import { dispatchToUser } from '../lib/delivery/index.js'
import { notificationTitle, notificationBody } from '../lib/notification-format.js'
import { ackDecision } from '../lib/occurrence-ack.js'
import { logger } from '../lib/logger.js'

export const occurrencesRouter = Router()
occurrencesRouter.use(requireUser)

/** Statuses that still need user attention. */
const ACTIVE_STATUSES: OccurrenceStatus[] = ['FIRED', 'ESCALATED', 'SNOOZED']
/** Past entries: handled, expired, or auto-resolved by a newer firing. */
const HISTORY_STATUSES: OccurrenceStatus[] = ['ACKNOWLEDGED', 'MISSED', 'SUPERSEDED']

// GET /api/occurrences?scope=active|upcoming|history
occurrencesRouter.get('/', async (request, response) => {
  const userId = requireUserId(request)
  const scope =
    request.query.scope === 'upcoming' ? 'upcoming' : request.query.scope === 'history' ? 'history' : 'active'
  const where =
    scope === 'upcoming'
      ? { userId, status: 'PENDING' as OccurrenceStatus }
      : scope === 'history'
        ? { userId, status: { in: HISTORY_STATUSES } }
        : { userId, status: { in: ACTIVE_STATUSES } }

  const occurrences = await prisma.reminderOccurrence.findMany({
    where,
    include: { reminder: true },
    orderBy: { scheduledFor: scope === 'upcoming' ? 'asc' : 'desc' },
    take: scope === 'upcoming' ? 100 : 200
  })
  response.json({ occurrences: occurrences.map(toOccurrence) })
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

  await silenceEverywhere(userId, updated.id, updated.reminder)
  broadcast(userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
  response.json({ occurrence: toOccurrence(updated) })
})

async function dismissEverywhere(userId: string, occurrenceId: string): Promise<void> {
  broadcast(userId, { type: 'dismiss', occurrenceId })
  await dispatchToUser(userId, { type: 'dismiss', occurrenceId })
}

/** Tell every device to stop the alarm but keep the soft nag for this occurrence. */
async function silenceEverywhere(
  userId: string,
  occurrenceId: string,
  reminder: Parameters<typeof notificationTitle>[0] & Parameters<typeof notificationBody>[0]
): Promise<void> {
  broadcast(userId, { type: 'silence', occurrenceId })
  await dispatchToUser(userId, {
    type: 'silence',
    occurrenceId,
    title: notificationTitle(reminder),
    body: notificationBody(reminder),
    alarm: false
  })
}
