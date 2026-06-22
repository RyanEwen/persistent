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
import { sendCloudflareEmail } from './cloudflare-email.js'
import { DateTime } from 'luxon'
import { toOccurrence } from './serializers.js'
import { broadcast } from './realtime.js'

const MATERIALIZE_WINDOW_MS = 48 * 60 * 60 * 1000
const TICK_INTERVAL_MS = 30_000
const MATERIALIZE_INTERVAL_MS = 5 * 60_000
const SWEEP_INTERVAL_MS = 60_000

const timers: NodeJS.Timeout[] = []

export function startScheduler(): void {
  void runSafely('revive-missed', reviveMissed)
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
  const schedule = reminder.schedule as unknown as Schedule
  // A one-shot has a single firing instant. If it has already slipped into the
  // past — the user defaulted it to "now" but submitted a moment later, lingered
  // on the form, or picked an earlier time — still materialize it (within a recent
  // window) so the tick fires it immediately instead of silently dropping it.
  // Repeating reminders keep `from = now` so today's already-passed times aren't
  // retroactively fired.
  const from = schedule.kind === 'once' ? new Date(now.getTime() - MATERIALIZE_WINDOW_MS) : now
  const instants = expandSchedule({
    schedule,
    startDate: reminder.startDate,
    endDate: reminder.endDate,
    timeZone,
    from,
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
    select: { id: true },
    take: 200
  })
  for (const occurrence of due) await fireOccurrence(occurrence.id)
}

/**
 * Flip one PENDING occurrence to FIRED and dispatch its notification. The status
 * guard makes it idempotent, so the tick and the on-create immediate-fire path
 * can't double-dispatch the same occurrence if they overlap.
 */
async function fireOccurrence(occurrenceId: string): Promise<void> {
  const claimed = await prisma.reminderOccurrence.updateMany({
    where: { id: occurrenceId, status: 'PENDING' },
    data: { status: 'FIRED', firedAt: new Date() }
  })
  if (claimed.count === 0) return // already fired by a concurrent path
  const occurrence = await prisma.reminderOccurrence.findUnique({
    where: { id: occurrenceId },
    include: { reminder: true }
  })
  if (!occurrence) return
  fireNotification(occurrence.userId, occurrence.reminder, occurrence.id, occurrence.scheduledFor, false)
  broadcast(occurrence.userId, { type: 'occurrence.fired', occurrence: toOccurrence(occurrence) })
}

/**
 * Fire any already-due PENDING occurrences for one reminder right now. Called on
 * create/update so a reminder whose first instant is already in the past (e.g. a
 * one-shot defaulted to "now") nags immediately instead of waiting for the tick.
 */
export async function fireDueForReminder(reminderId: string): Promise<void> {
  const due = await prisma.reminderOccurrence.findMany({
    where: { reminderId, status: 'PENDING', scheduledFor: { lte: new Date() } },
    select: { id: true },
    take: 200
  })
  for (const occurrence of due) await fireOccurrence(occurrence.id)
}

async function sweep(): Promise<void> {
  const now = new Date()

  // 1) Escalate occurrences past their threshold. Escalation is a HARD BACKSTOP:
  // it's anchored to the original fire (firedAt is never reset on snooze) and
  // fires even while SNOOZED, overriding the snooze.
  const escalatable = await prisma.reminderOccurrence.findMany({
    // A silenced occurrence keeps nagging but must never ring the alarm again.
    where: { status: { in: ['FIRED', 'SNOOZED'] }, firedAt: { not: null }, escalationSilencedAt: null },
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

  // 1b) Email escalation — independent of the alarm escalation, with its own
  // "how late". Sent once per occurrence (escalationEmailedAt guard), anchored to
  // the original fire.
  const emailable = await prisma.reminderOccurrence.findMany({
    where: {
      status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] },
      firedAt: { not: null },
      escalationEmailedAt: null,
      reminder: { is: { escalateEmail: { not: null }, escalateEmailAfterMinutes: { not: null } } }
    },
    include: { reminder: true },
    take: 200
  })
  for (const occurrence of emailable) {
    const r = occurrence.reminder
    if (r.escalateEmailAfterMinutes == null || !r.escalateEmail) continue
    const emailAt = (occurrence.firedAt as Date).getTime() + r.escalateEmailAfterMinutes * 60_000
    if (now.getTime() < emailAt) continue
    // Mark first so a slow send can't double-fire across overlapping sweeps.
    await prisma.reminderOccurrence.update({ where: { id: occurrence.id }, data: { escalationEmailedAt: now } })
    await sendEscalationEmail(r).catch((error) =>
      logger.warn('escalate email failed', { error: String(error), reminderId: r.id })
    )
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

  // NOTE: there is deliberately no "auto-miss" step. The persistence guarantee is
  // that a fired occurrence stays alive (FIRED/ESCALATED) until the user explicitly
  // confirms it (or deletes the reminder) — it must never time out on its own.
  // MISSED remains a valid status for a possible future *explicit* action, but the
  // scheduler never assigns it.
}

/**
 * One-time data fix-up: the scheduler used to auto-mark long-unacknowledged fires
 * as MISSED, which silently dropped the nag. That behavior is gone, so resurrect
 * any leftover MISSED occurrences back to FIRED (re-anchoring firedAt to now so the
 * nag/escalation restarts cleanly rather than instantly escalating). Self-cleaning:
 * once none remain — and nothing creates new ones — this is a no-op, so it's safe
 * to run on every boot and can be deleted in a later cleanup.
 */
async function reviveMissed(): Promise<void> {
  const now = new Date()
  let revived = 0
  for (;;) {
    const missed = await prisma.reminderOccurrence.findMany({
      where: { status: 'MISSED' },
      include: { reminder: true },
      take: 200
    })
    if (missed.length === 0) break
    for (const occurrence of missed) {
      const updated = await prisma.reminderOccurrence.update({
        where: { id: occurrence.id },
        data: { status: 'FIRED', firedAt: now, snoozedUntil: null },
        include: { reminder: true }
      })
      fireNotification(updated.userId, updated.reminder, updated.id, updated.scheduledFor, false)
      broadcast(updated.userId, { type: 'occurrence.fired', occurrence: toOccurrence(updated) })
      revived++
    }
  }
  if (revived > 0) logger.info('revived previously-missed occurrences to FIRED', { count: revived })
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

/** The alarm escalation: ring an alarm on the user's own devices. */
async function escalate(userId: string, reminder: Reminder, occurrenceId: string, scheduledFor: Date): Promise<void> {
  await dispatchToUser(userId, buildPayload('escalate', reminder, occurrenceId, scheduledFor, true)).catch((error) =>
    logger.warn('escalate dispatch failed', { error: String(error) })
  )
}

/** Send the (independent) escalation email with the user's custom message, or a default. */
async function sendEscalationEmail(reminder: Reminder): Promise<void> {
  const to = reminder.escalateEmail
  if (!to) return
  const message =
    reminder.escalateEmailMessage?.trim() || `The reminder "${reminder.title}" is overdue and hasn't been confirmed.`
  await sendCloudflareEmail({ to, subject: `Reminder overdue: ${reminder.title}`, text: message })
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
