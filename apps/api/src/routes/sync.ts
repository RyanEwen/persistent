/**
 * Native device sync. The Android client pulls upcoming + active occurrences so
 * it can (re)schedule on-device exact alarms that fire offline. This is the
 * "device-scheduled" half of the model; server push is the backup.
 *
 * It answers two different questions in one round trip, and the difference matters:
 * `alarms` is what the device should **arm** (everything due plus the next 48 hours —
 * each one an exact alarm the OS has to hold), while `agenda` is what it should be able
 * to **list** (a week, plus notes). Only the first can ring. See
 * `deviceAgendaEntrySchema`.
 */
import { Router } from 'express'
import { isTimeless, type DeviceAgendaEntry, type DeviceAlarm, type Schedule } from '@persistent/shared'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { toOccurrence, toCheckedItemIds } from '../lib/serializers.js'
import { escalateAtFor } from '../lib/escalation.js'
import { expandSchedule } from '../lib/schedule-expand.js'
import { buildDeviceAlarms } from '../lib/device-alarms.js'
import { notificationBody } from '../lib/notification-format.js'

export const syncRouter = Router()
syncRouter.use(requireUser)

const SYNC_WINDOW_MS = 48 * 60 * 60 * 1000
/**
 * How far ahead the readable agenda reaches. Wider than the armed window because
 * nothing here is armed: a driver opening the car list wants the week, not the two
 * days of alarms the OS is holding.
 */
const AGENDA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/**
 * Most timed rows the agenda will carry. A busy week is nowhere near this; a
 * pathological account (dozens of reminders, several times a day) could project a
 * thousand, and the agenda rides every sync. The furthest-out rows are the ones dropped,
 * and notes are never counted against it — there are few of them and they are the part a
 * driver is most likely to have opened the screen for.
 */
const AGENDA_MAX_TIMED = 200

// GET /api/sync/occurrences — everything the device should have a local alarm for,
// plus the wider set it should be able to show.
syncRouter.get('/occurrences', async (request, response) => {
  const userId = requireUserId(request)
  const now = new Date()
  // One query for both windows: the agenda is the wider of the two, and the armed set
  // is the near slice of it. Two queries would let them disagree mid-flight. Soonest
  // first, so the `take` can only ever cost the far end of the *agenda* — the armed
  // window is at the head of the list and is never the thing that gets cut.
  const occurrences = await prisma.reminderOccurrence.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'FIRED', 'SNOOZED', 'ESCALATED'] },
      scheduledFor: { lte: new Date(now.getTime() + AGENDA_WINDOW_MS) }
    },
    include: { reminder: true },
    orderBy: { scheduledFor: 'asc' },
    take: 500
  })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
  const tz = user?.timeZone ?? 'UTC'

  const armedUntil = now.getTime() + SYNC_WINDOW_MS
  const alarms: DeviceAlarm[] = []
  // Kept apart until the response is assembled: the timed rows are sorted and capped,
  // and a note has no time to be sorted by or to be dropped for being far off.
  const timed: DeviceAgendaEntry[] = []
  const notes: DeviceAgendaEntry[] = []
  const serialized: ReturnType<typeof toOccurrence>[] = []
  for (const o of occurrences) {
    // Escalation is a hard backstop anchored to the first fire, so the "after N
    // minutes" threshold counts from firedAt (or the scheduled time before it
    // fires) — never from the snooze.
    const base = o.firedAt ?? o.scheduledFor
    // No future escalation alarm for one that's already escalated (it rings now)
    // or that the user silenced (it must keep nagging without re-ringing).
    const escalateAt =
      o.status === 'ESCALATED' || o.escalationSilencedAt != null
        ? null
        : escalateAtFor(base, o.scheduledFor, o.reminder, tz)
    const checkedItemIds = toCheckedItemIds(o.checkedItems)
    timed.push({
      occurrenceId: o.id,
      reminderId: o.reminderId,
      title: o.reminder.title,
      body: notificationBody(o.reminder, checkedItemIds),
      // A snoozed firing is due when its snooze ends, matching the alarm the device
      // arms for it — the list must not say 09:00 for something that returns at 10:00.
      fireAtMs: (o.status === 'SNOOZED' && o.snoozedUntil ? o.snoozedUntil : o.scheduledFor).getTime(),
      note: false
    })
    // Beyond the armed window it is agenda only: listable, never armed. `scheduledFor`
    // rather than the snooze end, so a long snooze can't push a firing out of the set
    // the device is holding an alarm for.
    if (o.scheduledFor.getTime() > armedUntil) continue
    // The server expands each occurrence into the exact alarms the device should
    // arm, so the JS bridge and the native background worker share one transform.
    alarms.push(...buildDeviceAlarms(o, escalateAt))
    serialized.push({ ...toOccurrence(o), escalateAt: escalateAt?.toISOString() ?? null })
  }

  // The rest of the agenda comes from the definitions, because there are no rows for it
  // to come from: the scheduler materializes 48 hours ahead and no further (anything it
  // created beyond that would come back after the user confirmed it — see
  // `materializeReminder`). So the week past the materialized horizon is **projected**
  // here, through the same `expandSchedule` the materializer uses, and never written
  // down. A projected firing carries no occurrence id because it isn't one yet, which is
  // exactly right for a list: there is nothing to confirm about a reminder that hasn't
  // fired.
  //
  // Notes come from the definitions too, for a permanent version of the same reason —
  // they never produce an occurrence at all. They belong here for the reason they get a
  // tab of their own in the app: a kept list or a door code is reference material, and
  // the car screen is where a driver reads it.
  const reminders = await prisma.reminder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  // What the rows above already cover, so a projection can't duplicate a real firing in
  // the overlap (materialization runs every 5 minutes, so its horizon drifts).
  const materialized = new Set(occurrences.map((o) => `${o.reminderId}@${o.scheduledFor.getTime()}`))
  const agendaUntil = new Date(now.getTime() + AGENDA_WINDOW_MS)
  for (const reminder of reminders) {
    const schedule = reminder.schedule as unknown as Schedule
    if (schedule.kind === 'never') {
      notes.push({
        occurrenceId: '',
        reminderId: reminder.id,
        title: reminder.title,
        // A note's ticks live on the reminder (it has no firing to hold them), so its
        // unticked items come from there.
        body: notificationBody(reminder, toCheckedItemIds(reminder.checkedItems)),
        fireAtMs: 0,
        note: true
      })
      continue
    }
    // A paused reminder has no next firing to list, and neither timeless kind has one to
    // project: `none` gets its single firing minted the moment the user asks, and a note
    // is handled above.
    if (!reminder.active || isTimeless(schedule.kind)) continue
    const projected = expandSchedule({
      schedule,
      startDate: reminder.startDate,
      endDate: reminder.endDate,
      timeZone: tz,
      from: now,
      to: agendaUntil
    })
    for (const instant of projected) {
      if (materialized.has(`${reminder.id}@${instant.getTime()}`)) continue
      timed.push({
        occurrenceId: '',
        reminderId: reminder.id,
        title: reminder.title,
        // No ticks to leave out: nothing has fired, so nothing has been done.
        body: notificationBody(reminder, []),
        fireAtMs: instant.getTime(),
        note: false
      })
    }
  }

  // Soonest first, so the cap drops the furthest-out rows rather than an arbitrary set.
  timed.sort((a, b) => a.fireAtMs - b.fireAtMs)
  response.json({
    serverTime: now.toISOString(),
    timeZone: tz,
    occurrences: serialized,
    alarms,
    agenda: [...timed.slice(0, AGENDA_MAX_TIMED), ...notes]
  })
})
