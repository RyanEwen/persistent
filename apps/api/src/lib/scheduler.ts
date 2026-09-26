/**
 * Scheduling engine: materialize occurrences, fire due ones, sweep snoozes and
 * escalations. The server is the source of truth; native clients additionally
 * schedule local alarms (device-scheduled + server backup).
 *
 * Loops (all unref'd so they never hold the process open in tests):
 * - materialize every 5 min: expand active reminders into the next 48h.
 * - tick every 30 s: fire PENDING occurrences whose time has arrived.
 * - sweep every 60 s: revive elapsed snoozes; escalate ignored fires; miss stale ones.
 *
 * Each occurrence is independent: a reminder with several times of day (or one
 * that repeats) fires, nags, and is confirmed one occurrence at a time. The
 * 9:00 dose staying unconfirmed does not suppress the 13:00 dose, and confirming
 * 13:00 does not clear 9:00 — every firing must be acknowledged on its own.
 * (The legacy `SUPERSEDED` status is no longer produced; old rows may still carry
 * it and live in History.)
 */
import type { OccurrenceStatus, Reminder, ReminderOccurrence } from '@prisma/client'
import type { PushPayload, Schedule } from '@persistent/shared'
import { isTimeless } from '@persistent/shared'
import { prisma } from './prisma.js'
import { logger } from './logger.js'
import { expandSchedule } from './schedule-expand.js'
import { notificationTitle, notificationBody, escalationEmailText } from './notification-format.js'
import { dispatchToUser } from './delivery/index.js'
import { sendCloudflareEmail } from './cloudflare-email.js'
import { escalateAtFor, groupEmailEscalationAt, shouldEscalateNow } from './escalation.js'
import { firingSounds } from './reminder-sounds.js'
import { toOccurrence, toCheckedItemIds } from './serializers.js'
import { broadcast } from './realtime.js'
import { broadcastSharedChange, participantIds } from './share-access.js'
import { broadcastAssignmentProgress } from './assignment-progress.js'
import {
  claimRecipientEscalation,
  claimRecipientSnoozeRevival,
  occurrenceForActor
} from './recipient-alert-state.js'

/** Statuses that still have a firing in front of the user (i.e. not terminal). */
const LIVE_STATUSES: OccurrenceStatus[] = ['PENDING', 'FIRED', 'ESCALATED', 'SNOOZED']

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

/**
 * The single firing of an unscheduled reminder ("remind me about this", no
 * date/time). Minted only by the deliberate acts that call for one — creating a
 * reminder unscheduled, or taking an existing reminder's schedule away — never by
 * a materialization pass, so no timer can resurrect a nag the user has confirmed.
 *
 * It is skipped entirely when the reminder already has a live occurrence. Taking
 * the schedule off a reminder whose last firing is still unconfirmed leaves that
 * firing in place (only Done clears a firing — docs/notification-behavior.md §1);
 * adding a second one would nag twice about one thing, with both cards reading
 * identically because an unscheduled firing has no time to tell them apart.
 */
export async function ensureUnscheduledFiring(reminder: Reminder, at: Date): Promise<void> {
  if (!reminder.active) return
  const live = await prisma.reminderOccurrence.findFirst({
    where: { reminderId: reminder.id, userId: reminder.userId, status: { in: LIVE_STATUSES } },
    select: { id: true }
  })
  if (live) {
    // Logged because it is the branch that explains an absence: the user took a
    // schedule off and got no new nag, which is correct but looks like a miss.
    logger.info('unscheduled firing not minted, one is already nagging', {
      reminderId: reminder.id,
      occurrenceId: live.id
    })
    return
  }
  await prisma.reminderOccurrence.createMany({
    data: [{ reminderId: reminder.id, userId: reminder.userId, scheduledFor: at }],
    skipDuplicates: true
  })
}

/** Expand a single reminder's schedule into occurrence rows for the rolling window. */
export async function materializeReminder(reminder: Reminder, timeZone: string, now = new Date()): Promise<void> {
  if (!reminder.active) return
  const schedule = reminder.schedule as unknown as Schedule
  // Neither timeless kind has anything to expand. A note (`never`) has no firing
  // at all, and an unscheduled reminder's (`none`) one firing is minted by
  // `ensureUnscheduledFiring` at the moment the user asks for it. Materialization
  // deliberately does nothing for either: it runs every 5 minutes, so anything it
  // created would come back after the user confirmed it.
  if (isTimeless(schedule.kind)) return
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
  const now = new Date()
  const claimed = await prisma.reminderOccurrence.updateMany({
    where: { id: occurrenceId, status: 'PENDING' },
    data: { status: 'FIRED', firedAt: now, lastNotifiedAt: now }
  })
  if (claimed.count === 0) return // already fired by a concurrent path
  const occurrence = await prisma.reminderOccurrence.findUnique({
    where: { id: occurrenceId },
    include: { reminder: true }
  })
  if (!occurrence) return
  // Each occurrence nags on its own — a fresh fire never supersedes an earlier
  // still-unconfirmed firing of the same reminder. A reminder with several times
  // of day shows one notification per fired occurrence, each confirmed separately.
  const members = await participantIds(occurrence.reminderId, occurrence.userId)
  for (const memberId of members) fireNotificationFor(occurrence, memberId, false)
  broadcast(occurrence.userId, { type: 'occurrence.fired', occurrence: toOccurrence(occurrence) })
  await broadcastSharedChange(occurrence.reminderId, occurrence.userId)
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

  // 1) Escalate occurrences past their threshold. Escalation is a HARD BACKSTOP
  // anchored to the original fire (firedAt is never reset on snooze), so you can't
  // defer it forever by snoozing — but an active snooze is honored for its full
  // duration (shouldEscalateNow), and the alarm re-escalates the moment it ends.
  const escalatable = await prisma.reminderOccurrence.findMany({
    // A silenced occurrence keeps nagging but must never ring the alarm again.
    where: { status: { in: ['FIRED', 'SNOOZED'] }, firedAt: { not: null }, escalationSilencedAt: null },
    include: { reminder: true, user: { select: { timeZone: true } } },
    take: 200
  })
  for (const occurrence of escalatable) {
    const tz = occurrence.user?.timeZone ?? 'UTC'
    const escalateAt = escalateAtFor(occurrence.firedAt as Date, occurrence.scheduledFor, occurrence.reminder, tz)
    // An unelapsed snooze is honored: re-escalate only once the snooze ends, not
    // on every 60s sweep (else a 5-min snooze rings again in ~1 min).
    if (shouldEscalateNow(escalateAt, occurrence.snoozedUntil, now)) {
      const claimed = await prisma.reminderOccurrence.updateMany({
        where: { id: occurrence.id, status: { in: ['FIRED', 'SNOOZED'] }, escalationSilencedAt: null },
        data: { status: 'ESCALATED', escalatedAt: now, lastNotifiedAt: now, snoozedUntil: null }
      })
      if (claimed.count === 0) continue
      const updated = await prisma.reminderOccurrence.findUniqueOrThrow({
        where: { id: occurrence.id },
        include: { reminder: true }
      })
      await escalate(updated)
      broadcast(updated.userId, { type: 'occurrence.changed', occurrence: toOccurrence(updated) })
      await broadcastAssignmentProgress(updated.reminderId)
    }
  }

  // A recipient's escalation is independent of the owner's snooze or alarm.
  // Email escalation remains one message on the canonical occurrence below.
  const sharedFirings = await prisma.reminderOccurrence.findMany({
    where: {
      status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] },
      firedAt: { not: null },
      reminder: { shares: { some: {} } }
    },
    include: {
      reminder: { include: { shares: true, user: { select: { timeZone: true } } } },
      recipientAlerts: true
    },
    take: 200
  })
  for (const occurrence of sharedFirings) {
    const tz = occurrence.reminder.user.timeZone
    const escalateAt = escalateAtFor(occurrence.firedAt as Date, occurrence.scheduledFor, occurrence.reminder, tz)
    for (const share of occurrence.reminder.shares) {
      const state = occurrence.recipientAlerts.find((alert) => alert.recipientId === share.recipientId)
      if (state?.escalatedAt || state?.escalationSilencedAt) continue
      if (!shouldEscalateNow(escalateAt, state?.snoozedUntil ?? null, now)) continue

      const updatedState = await claimRecipientEscalation(occurrence.id, share.recipientId, now)
      if (!updatedState) continue

      // Completion or removal can happen while the claim is in flight. Fetch
      // current content before preparing a push from this scheduler snapshot.
      const current = await prisma.reminderOccurrence.findFirst({
        where: {
          id: occurrence.id,
          status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] },
          reminder: { shares: { some: { recipientId: share.recipientId } } }
        },
        include: { reminder: true }
      })
      if (!current) continue

      const personal = occurrenceForActor(current, share.recipientId, updatedState)
      await dispatchToUser(share.recipientId, buildPayload('escalate', personal, true)).catch((error) =>
        logger.warn('shared escalation dispatch failed', { error: String(error), occurrenceId: occurrence.id })
      )
      broadcast(share.recipientId, { type: 'reminder.changed', reminderId: occurrence.reminderId })
    }
  }

  // 1b) The covering email is shared, so it waits for the configured delay AND
  // the latest snooze among current participants. Alarm escalation stays personal.
  const emailable = await prisma.reminderOccurrence.findMany({
    where: {
      status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] },
      firedAt: { not: null },
      escalationEmailedAt: null,
      reminder: { is: { escalateEmail: { not: null }, escalateEmailAfterMinutes: { not: null } } }
    },
    include: {
      reminder: { include: { shares: { select: { recipientId: true } } } },
      recipientAlerts: { select: { recipientId: true, snoozedUntil: true } }
    },
    take: 200
  })
  for (const occurrence of emailable) {
    const r = occurrence.reminder
    if (r.escalateEmailAfterMinutes == null || !r.escalateEmail) continue
    const currentRecipients = new Set(r.shares.map((share) => share.recipientId))
    const groupSnoozes = [
      occurrence.snoozedUntil,
      ...occurrence.recipientAlerts
        .filter((alert) => currentRecipients.has(alert.recipientId))
        .map((alert) => alert.snoozedUntil)
    ]
    const emailAt = groupEmailEscalationAt(occurrence.firedAt as Date, r.escalateEmailAfterMinutes, groupSnoozes)
    if (now < emailAt) continue
    // Mark first so a slow send can't double-fire across overlapping sweeps.
    const claimed = await prisma.reminderOccurrence.updateMany({
      where: {
        id: occurrence.id,
        status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] },
        escalationEmailedAt: null,
        AND: [
          { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
          {
            recipientAlerts: {
              none: {
                snoozedUntil: { gt: now },
                recipient: { receivedShares: { some: { reminderId: occurrence.reminderId } } }
              }
            }
          }
        ]
      },
      data: { escalationEmailedAt: now }
    })
    if (claimed.count === 0) continue
    await sendEscalationEmail(r, toCheckedItemIds(occurrence.checkedItems)).catch((error) =>
      logger.warn('escalate email failed', { error: String(error), reminderId: r.id })
    )
  }

  // 2) Revive elapsed snoozes that didn't escalate. Keep the original firedAt so
  // the escalation backstop stays anchored to the first fire — but stamp
  // lastNotifiedAt, because coming back from a snooze IS a fresh appearance and
  // should sort as the newest thing on the list.
  const snoozed = await prisma.reminderOccurrence.findMany({
    where: { status: 'SNOOZED', snoozedUntil: { lte: now } },
    include: { reminder: true },
    take: 200
  })
  for (const occurrence of snoozed) {
    const claimed = await prisma.reminderOccurrence.updateMany({
      where: { id: occurrence.id, status: 'SNOOZED', snoozedUntil: { lte: now } },
      data: { status: 'FIRED', lastNotifiedAt: now, snoozedUntil: null }
    })
    if (claimed.count === 0) continue
    const updated = await prisma.reminderOccurrence.findUniqueOrThrow({
      where: { id: occurrence.id },
      include: { reminder: true }
    })
    // A revived snooze nags again on its own; it never supersedes its siblings.
    fireNotification(updated, false)
    broadcast(updated.userId, { type: 'occurrence.fired', occurrence: toOccurrence(updated) })
    await broadcastAssignmentProgress(updated.reminderId)
  }

  const recipientSnoozes = await prisma.recipientAlertState.findMany({
    where: {
      snoozedUntil: { lte: now },
      occurrence: { status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] } }
    },
    include: { occurrence: { include: { reminder: { include: { shares: true } } } } },
    take: 200
  })
  for (const state of recipientSnoozes) {
    const occurrence = state.occurrence
    if (!occurrence.reminder.shares.some((share) => share.recipientId === state.recipientId)) continue

    const updatedState = await claimRecipientSnoozeRevival(state.occurrenceId, state.recipientId, now)
    if (!updatedState) continue

    const current = await prisma.reminderOccurrence.findFirst({
      where: {
        id: state.occurrenceId,
        status: { in: ['FIRED', 'SNOOZED', 'ESCALATED'] },
        reminder: { shares: { some: { recipientId: state.recipientId } } }
      },
      include: { reminder: true }
    })
    if (!current) continue

    const personal = occurrenceForActor(current, state.recipientId, updatedState)
    fireNotificationFor(personal, state.recipientId, personal.status === 'ESCALATED')
    broadcast(state.recipientId, { type: 'occurrence.fired', occurrence: toOccurrence(personal) })
    broadcast(state.recipientId, { type: 'reminder.changed', reminderId: current.reminderId })
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
        data: { status: 'FIRED', firedAt: now, lastNotifiedAt: now, snoozedUntil: null },
        include: { reminder: true }
      })
      fireNotification(updated, false)
      broadcast(updated.userId, { type: 'occurrence.fired', occurrence: toOccurrence(updated) })
      await broadcastSharedChange(updated.reminderId, updated.userId)
      revived++
    }
  }
  if (revived > 0) logger.info('revived previously-missed occurrences to FIRED', { count: revived })
}

/**
 * The whole occurrence, not just its id: the notification body is built from the
 * firing's ticks as well as its reminder, so a checklist nags with only the items
 * still outstanding.
 */
type OccurrenceForNotification = ReminderOccurrence & { reminder: Reminder }

function buildPayload(type: PushPayload['type'], occurrence: OccurrenceForNotification, alarm: boolean): PushPayload {
  const { reminder } = occurrence
  const rings = alarm || reminder.persistence === 'ALARM'
  // A fire/escalate push only acts on a device with no local alarm for the
  // occurrence, so it is the device's only chance to learn the reminder's tone.
  // Flattened to scalars because FCM data values are strings.
  const { sound, nagSound } = firingSounds(reminder.sounds, rings)
  return {
    type,
    occurrenceId: occurrence.id,
    reminderId: reminder.id,
    title: notificationTitle(reminder),
    body: notificationBody(reminder, toCheckedItemIds(occurrence.checkedItems)),
    alarm: rings,
    soundIntervalSeconds: reminder.soundIntervalSeconds,
    scheduledFor: occurrence.scheduledFor.toISOString(),
    ...(sound ? { soundUri: sound.uri, soundTitle: sound.title } : {}),
    ...(nagSound ? { nagSoundUri: nagSound.uri, nagSoundTitle: nagSound.title } : {})
  }
}

function fireNotification(occurrence: OccurrenceForNotification, alarm: boolean): void {
  fireNotificationFor(occurrence, occurrence.userId, alarm)
}

/** Send one participant's own alert while retaining the shared occurrence id. */
function fireNotificationFor(occurrence: OccurrenceForNotification, userId: string, alarm: boolean): void {
  void dispatchToUser(userId, buildPayload('fire', occurrence, alarm)).catch((error) =>
    logger.warn('fire dispatch failed', { error: String(error) })
  )
}

/** The alarm escalation: ring an alarm on the user's own devices. */
async function escalate(occurrence: OccurrenceForNotification): Promise<void> {
  await dispatchToUser(occurrence.userId, buildPayload('escalate', occurrence, true)).catch((error) =>
    logger.warn('escalate dispatch failed', { error: String(error) })
  )
}

/**
 * Send the (independent) escalation email: the user's covering message plus the
 * reminder's body, so the recipient sees *what* is overdue and not just its title
 * (an escalation contact acting on "hasn't taken the 9:00 dose" needs the dose).
 * This deliberately includes medications, and is deliberately not gated behind a
 * per-reminder opt-in: withholding the dose from the person you nominated to chase
 * a missed dose defeats the point of the escalation. The address and the covering
 * message are the user's to choose, and a reminder with no details still sends
 * just the message.
 */
async function sendEscalationEmail(reminder: Reminder, checkedItemIds: readonly string[]): Promise<void> {
  const to = reminder.escalateEmail
  if (!to) return
  await sendCloudflareEmail({
    to,
    subject: `Reminder overdue: ${reminder.title}`,
    text: escalationEmailText(reminder, checkedItemIds)
  })
}
