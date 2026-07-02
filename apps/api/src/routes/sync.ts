/**
 * Native device sync. The Android client pulls upcoming + active occurrences so
 * it can (re)schedule on-device exact alarms that fire offline. This is the
 * "device-scheduled" half of the model; server push is the backup.
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { toOccurrence } from '../lib/serializers.js'
import { escalateAtFor } from '../lib/escalation.js'
import { buildDeviceAlarms } from '../lib/device-alarms.js'
import type { DeviceAlarm } from '@persistent/shared'

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

  const alarms: DeviceAlarm[] = []
  const serialized = occurrences.map((o) => {
    // Escalation is a hard backstop anchored to the first fire, so the "after N
    // minutes" threshold counts from firedAt (or the scheduled time before it
    // fires) — never from the snooze. Already-escalated occurrences need no
    // future escalation alarm (the device rings immediately for those).
    const base = o.firedAt ?? o.scheduledFor
    // No future escalation alarm for one that's already escalated (it rings now)
    // or that the user silenced (it must keep nagging without re-ringing).
    const escalateAt =
      o.status === 'ESCALATED' || o.escalationSilencedAt != null
        ? null
        : escalateAtFor(base, o.scheduledFor, o.reminder, tz)
    // The server expands each occurrence into the exact alarms the device should
    // arm, so the JS bridge and the native background worker share one transform.
    alarms.push(...buildDeviceAlarms(o, escalateAt))
    return { ...toOccurrence(o), escalateAt: escalateAt?.toISOString() ?? null }
  })

  response.json({
    serverTime: now.toISOString(),
    timeZone: tz,
    occurrences: serialized,
    alarms
  })
})
