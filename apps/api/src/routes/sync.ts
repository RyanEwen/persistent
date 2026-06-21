/**
 * Native device sync. The Android client pulls upcoming + active occurrences so
 * it can (re)schedule on-device exact alarms that fire offline. This is the
 * "device-scheduled" half of the model; server push is the backup.
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { toOccurrence } from '../lib/serializers.js'
import { escalateAtFor } from '../lib/scheduler.js'

export const syncRouter = Router()
syncRouter.use(requireUser)

const SYNC_WINDOW_MS = 48 * 60 * 60 * 1000

// GET /api/sync/occurrences — everything the device should have a local alarm for.
syncRouter.get('/occurrences', async (request, response) => {
  const userId = requireUserId(request)
  const now = new Date()
  const occurrences = await prisma.reminderOccurrence.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'FIRED', 'SNOOZED', 'ESCALATED'] },
      scheduledFor: { lte: new Date(now.getTime() + SYNC_WINDOW_MS) }
    },
    include: { reminder: true },
    orderBy: { scheduledFor: 'asc' },
    take: 500
  })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
  const tz = user?.timeZone ?? 'UTC'

  response.json({
    serverTime: now.toISOString(),
    timeZone: tz,
    occurrences: occurrences.map((o) => {
      // Base the "after N minutes" threshold on the same fire instant the device
      // schedules the main alarm for (snoozed -> revive time, fired -> firedAt,
      // else the scheduled time). Already-escalated occurrences need no future
      // escalation alarm (the device rings immediately for those).
      const base = o.status === 'SNOOZED' && o.snoozedUntil ? o.snoozedUntil : (o.firedAt ?? o.scheduledFor)
      const escalateAt = o.status === 'ESCALATED' ? null : escalateAtFor(base, o.scheduledFor, o.reminder, tz)
      return { ...toOccurrence(o), escalateAt: escalateAt?.toISOString() ?? null }
    })
  })
})
