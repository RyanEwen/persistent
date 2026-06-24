import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { escalateAtFor } from './escalation.js'

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
