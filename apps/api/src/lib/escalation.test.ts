import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { escalateAtFor, shouldEscalateNow } from './escalation.js'

const TZ = 'America/Toronto'

/** A wall-clock instant in America/Toronto as a JS Date. */
function toronto(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate()
}

test('escalateAtTime earlier in the day than the firing rolls to the next morning', () => {
  // Meds: fires 23:45, escalates 01:30. The escalation must be the NEXT day's
  // 01:30 (after firing), not the same day's 01:30 (~22h before firing).
  const scheduledFor = toronto('2026-06-24T23:45')
  const escalateAt = escalateAtFor(scheduledFor, scheduledFor, { escalateAfterMinutes: null, escalateAtTime: '01:30' }, TZ)
  assert.deepEqual(escalateAt, toronto('2026-06-25T01:30'))
  assert.ok(escalateAt!.getTime() > scheduledFor.getTime(), 'escalation must be after the firing')
})

test('escalateAtTime later in the day than the firing stays on the same day', () => {
  const scheduledFor = toronto('2026-06-24T08:00')
  const escalateAt = escalateAtFor(scheduledFor, scheduledFor, { escalateAfterMinutes: null, escalateAtTime: '10:00' }, TZ)
  assert.deepEqual(escalateAt, toronto('2026-06-24T10:00'))
})

test('escalateAtTime equal to the firing time rolls to the next day (never simultaneous)', () => {
  const scheduledFor = toronto('2026-06-24T08:00')
  const escalateAt = escalateAtFor(scheduledFor, scheduledFor, { escalateAfterMinutes: null, escalateAtTime: '08:00' }, TZ)
  assert.deepEqual(escalateAt, toronto('2026-06-25T08:00'))
})

test('escalateAfterMinutes counts from the fired base', () => {
  const scheduledFor = toronto('2026-06-24T23:45')
  const escalateAt = escalateAtFor(scheduledFor, scheduledFor, { escalateAfterMinutes: 30, escalateAtTime: null }, TZ)
  assert.deepEqual(escalateAt, toronto('2026-06-25T00:15'))
})

test('no escalation configured yields null', () => {
  const scheduledFor = toronto('2026-06-24T23:45')
  assert.equal(escalateAtFor(scheduledFor, scheduledFor, { escalateAfterMinutes: null, escalateAtTime: null }, TZ), null)
})

const SNOOZE_NOW = new Date('2026-06-24T12:00:00.000Z')
const past = new Date('2026-06-24T11:00:00.000Z') // escalation threshold already elapsed

test('does not escalate before the escalation instant', () => {
  const future = new Date('2026-06-24T13:00:00.000Z')
  assert.equal(shouldEscalateNow(future, null, SNOOZE_NOW), false)
})

test('escalates once the instant has passed and no snooze is active', () => {
  assert.equal(shouldEscalateNow(past, null, SNOOZE_NOW), true)
})

test('an unelapsed snooze suppresses escalation even though the threshold passed', () => {
  // The meds bug: escalateAt is anchored to the original fire (long past), so
  // without this guard the sweep re-escalates a 5-min snooze within ~1 min.
  const snoozedUntil = new Date('2026-06-24T12:05:00.000Z')
  assert.equal(shouldEscalateNow(past, snoozedUntil, SNOOZE_NOW), false)
})

test('escalates again the moment the snooze elapses', () => {
  const snoozedUntil = new Date('2026-06-24T12:00:00.000Z') // exactly now
  assert.equal(shouldEscalateNow(past, snoozedUntil, SNOOZE_NOW), true)
})

test('no escalation configured never escalates, snooze or not', () => {
  assert.equal(shouldEscalateNow(null, null, SNOOZE_NOW), false)
})
