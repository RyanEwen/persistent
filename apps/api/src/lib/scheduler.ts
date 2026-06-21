/**
 * Scheduling engine: materialize occurrences, fire due ones, sweep snoozes and
 * escalations. The server is the source of truth; native clients additionally
 * schedule local alarms (device-scheduled + server backup).
 *
 * Loops (all unref'd so they never hold the process open in tests):
 * - materialize every 5 min: expand active reminders into the next 48h.
 * - tick every 30 s: fire PENDING occurrences whose time has arrived.
 * - sweep every 60 s: revive elapsed snoozes; escalate ignored fires; miss stale ones.
 */
import type { Reminder } from '@prisma/client'
import type { PushPayload, Schedule } from '@persistent/shared'
import { prisma } from './prisma.js'
import { logger } from './logger.js'
import { expandSchedule } from './schedule-expand.js'
import { notificationTitle, notificationBody } from './notification-format.js'
import { dispatchToUser } from './delivery/index.js'
import { DateTime } from 'luxon'
import { toOccurrence } from './serializers.js'
import { broadcast } from './realtime.js'

const MATERIALIZE_WINDOW_MS = 48 * 60 * 60 * 1000
const TICK_INTERVAL_MS = 30_000
const MATERIALIZE_INTERVAL_MS = 5 * 60_000
const SWEEP_INTERVAL_MS = 60_000
/** A fired-but-unacknowledged occurrence older than this (without its own escalation) is marked MISSED. */
const MISS_AFTER_MS = 12 * 60 * 60 * 1000

const timers: NodeJS.Timeout[] = []

export function startScheduler(): void {
  void runSafely('materialize', materializeAll)
  void runSafely('tick', tick)
  for (const [fn, interval] of [
    [materializeAll, MATERIALIZE_INTERVAL_MS],
    [tick, TICK_INTERVAL_MS],
    [sweep, SWEEP_INTERVAL_MS]
  ] as const) {
    const timer = setInterval(() => void runSafely(fn.name, fn), interval)
    timer.unref()
    timers.push(timer)
  }
  logger.info('scheduler started')
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer)
  timers.length = 0
}

async function runSafely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    logger.error(`scheduler ${label} failed`, { error: String(error) })
  }
}

/** Expand a single reminder's schedule into occurrence rows for the rolling window. */
export async function materializeReminder(reminder: Reminder, timeZone: string, now = new Date()): Promise<void> {
  if (!reminder.active) return
  const instants = expandSchedule({
    schedule: reminder.schedule as unknown as Schedule,
    startDate: reminder.startDate,
    endDate: reminder.endDate,
    timeZone,
    from: now,
    to: new Date(now.getTime() + MATERIALIZE_WINDOW_MS)
  })
  if (instants.length === 0) return
  await prisma.reminderOccurrence.createMany({
    data: instants.map((scheduledFor) => ({
      reminderId: reminder.id,
      userId: reminder.userId,
      scheduledFor
    })),
    skipDuplicates: true
  })
}

async function materializeAll(): Promise<void> {
  const reminders = await prisma.reminder.findMany({
    where: { active: true },
    include: { user: { select: { timeZone: true } } }
  })
  const now = new Date()
  for (const reminder of reminders) {
    await materializeReminder(reminder, reminder.user.timeZone, now)
  }
}

async function tick(): Promise<void> {
  const now = new Date()
  const due = await prisma.reminderOccurrence.findMany({
    where: { status: 'PENDING', scheduledFor: { lte: now } },
    include: { reminder: true },
    take: 200
  })
  for (const occurrence of due) {
    const updated = await prisma.reminderOccurrence.update({
      where: { id: occurrence.id },
      data: { status: 'FIRED', firedAt: now },
      include: { reminder: true }
    })
    fireNotification(updated.userId, updated.reminder, occurrence.id, occurrence.scheduledFor, false)
    broadcast(updated.userId, { type: 'occurrence.fired', occurrence: toOccurrence(updated) })
  }
}

async function sweep(): Promise<void> {
  const now = new Date()

  // 1) Escalate occurrences past their threshold. Escalation is a HARD BACKSTOP:
  // it's anchored to the original fire (firedAt is never reset on snooze) and
  // fires even while SNOOZED, overriding the snooze.
  const escalatable = await prisma.reminderOccurrence.findMany({
    where: { status: { in: ['FIRED', 'SNOOZED'] }, firedAt: { not: null } },
    include: { reminder: true, user: { select: { timeZone: true } } },
    take: 200
  })
  for (const occurrence of escalatable) {
    const tz = occurrence.user?.timeZone ?? 'UTC'
    const escalateAt = escalateAtFor(occurrence.firedAt as Date, occurrence.scheduledFor, occurrence.reminder, tz)
    if (escalateAt != null && now.getTime() >= escalateAt.getTime()) {
      const updated = await prisma.reminderOccurrence.update({
        where: { id: occurrence.id },
        data: { status: 'ESCALATED', escalatedAt: now, snoozedUntil: null },
        include: { reminder: true }
      })
      await escalate(updated.userId, updated.reminder, updated.id, updated.scheduledFor)
      broadcast(updated.userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
    }
  }

  // 2) Revive elapsed snoozes that didn't escalate. Keep the original firedAt so
  // the escalation backstop stays anchored to the first fire.
  const snoozed = await prisma.reminderOccurrence.findMany({
    where: { status: 'SNOOZED', snoozedUntil: { lte: now } },
    include: { reminder: true },
    take: 200
  })
  for (const occurrence of snoozed) {
    const updated = await prisma.reminderOccurrence.update({
      where: { id: occurrence.id },
      data: { status: 'FIRED', snoozedUntil: null },
      include: { reminder: true }
    })
    fireNotification(updated.userId, updated.reminder, updated.id, updated.scheduledFor, false)
    broadcast(updated.userId, { type: 'occurrence.fired', occurrence: toOccurrence(updated) })
  }

  // 3) Mark long-unacknowledged fires (from the original fire time) as missed.
  const fired = await prisma.reminderOccurrence.findMany({
    where: { status: 'FIRED', firedAt: { not: null } },
    include: { reminder: true },
    take: 200
  })
  for (const occurrence of fired) {
    if (now.getTime() - (occurrence.firedAt as Date).getTime() >= MISS_AFTER_MS) {
      const updated = await prisma.reminderOccurrence.update({
        where: { id: occurrence.id },
        data: { status: 'MISSED' },
        include: { reminder: true }
      })
      broadcast(updated.userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
    }
  }
}

function buildPayload(
  type: PushPayload['type'],
  reminder: Reminder,
  occurrenceId: string,
  scheduledFor: Date,
  alarm: boolean
): PushPayload {
  return {
    type,
    occurrenceId,
    reminderId: reminder.id,
    title: notificationTitle(reminder),
    body: notificationBody(reminder),
    alarm: alarm || reminder.persistence === 'ALARM',
    soundIntervalSeconds: reminder.soundIntervalSeconds,
    scheduledFor: scheduledFor.toISOString()
  }
}

function fireNotification(userId: string, reminder: Reminder, occurrenceId: string, scheduledFor: Date, alarm: boolean): void {
  void dispatchToUser(userId, buildPayload('fire', reminder, occurrenceId, scheduledFor, alarm)).catch((error) =>
    logger.warn('fire dispatch failed', { error: String(error) })
  )
}

/** Escalation always rings an alarm on the user's own devices. */
async function escalate(userId: string, reminder: Reminder, occurrenceId: string, scheduledFor: Date): Promise<void> {
  await dispatchToUser(userId, buildPayload('escalate', reminder, occurrenceId, scheduledFor, true)).catch((error) =>
    logger.warn('escalate dispatch failed', { error: String(error) })
  )
}

/**
 * When an occurrence escalates to an alarm, or null if no escalation is set.
 * `firedBase` is the fire instant the "after N minutes" threshold counts from
 * (the occurrence's firedAt once fired, else its scheduled time). Shared by the
 * server sweep and the /api/sync endpoint (which schedules the alarm on-device).
 */
export function escalateAtFor(
  firedBase: Date,
  scheduledFor: Date,
  reminder: { escalateAfterMinutes: number | null; escalateAtTime: string | null },
  tz: string
): Date | null {
  if (reminder.escalateAfterMinutes != null) {
    return new Date(firedBase.getTime() + reminder.escalateAfterMinutes * 60_000)
  }
  if (reminder.escalateAtTime != null) {
    return escalationInstant(scheduledFor, reminder.escalateAtTime, tz)
  }
  return null
}

/** Absolute escalation instant: the occurrence's local day at "HH:mm" in the user's zone. */
function escalationInstant(scheduledFor: Date, hhmm: string, tz: string): Date {
  const [hs, ms] = hhmm.split(':')
  const hour = Number(hs)
  const minute = Number(ms)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return new Date(8.64e15) // never (far future)
  return DateTime.fromJSDate(scheduledFor, { zone: tz })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate()
}
