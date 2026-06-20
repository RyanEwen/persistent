/**
 * Occurrence routes: the "due now / needs confirmation" feed plus the explicit
 * completion (ack) and snooze actions.
 *
 * Acknowledging or snoozing broadcasts a `dismiss` (over WS and push) so the
 * notification clears on every one of the user's devices — the cross-device
 * dismiss sync that backs the "device-scheduled + server backup" model.
 */
import { Router } from 'express'
import { snoozeInputSchema, type OccurrenceStatus } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound } from '../lib/http-error.js'
import { toOccurrence } from '../lib/serializers.js'
import { broadcast } from '../lib/realtime.js'
import { dispatchToUser } from '../lib/delivery/index.js'

export const occurrencesRouter = Router()
occurrencesRouter.use(requireUser)

/** Statuses that still need user attention. */
const ACTIVE_STATUSES: OccurrenceStatus[] = ['FIRED', 'ESCALATED', 'SNOOZED']
/** Past entries: handled or expired. */
const HISTORY_STATUSES: OccurrenceStatus[] = ['ACKNOWLEDGED', 'MISSED']

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
  const existing = await prisma.reminderOccurrence.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Occurrence not found.')

  const updated = await prisma.reminderOccurrence.update({
    where: { id: existing.id },
    data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
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

  const existing = await prisma.reminderOccurrence.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Occurrence not found.')

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

async function dismissEverywhere(userId: string, occurrenceId: string): Promise<void> {
  broadcast(userId, { type: 'dismiss', occurrenceId })
  await dispatchToUser(userId, { type: 'dismiss', occurrenceId })
}
