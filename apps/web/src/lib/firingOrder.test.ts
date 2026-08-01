import test from 'node:test'
import assert from 'node:assert/strict'
import type { Occurrence, OccurrenceStatus } from '@persistent/shared'
import { compareFirings } from './firingOrder.js'

function firing(id: string, firedAt: string | null, status: OccurrenceStatus = 'FIRED'): Occurrence {
  // scheduledFor deliberately differs from firedAt, so a test that passes by
  // reading the wrong field would order things backwards.
  return { id, status, firedAt, scheduledFor: '2020-01-01T00:00:00.000Z' } as Occurrence
}

function order(occurrences: Occurrence[]): string[] {
  return [...occurrences].sort(compareFirings).map((o) => o.id)
}

test('the most recently fired firing comes first', () => {
  const old = firing('old', '2026-08-01T09:00:00.000Z')
  const fresh = firing('fresh', '2026-08-01T17:00:00.000Z')
  assert.deepEqual(order([old, fresh]), ['fresh', 'old'])
  assert.deepEqual(order([fresh, old]), ['fresh', 'old'])
})

test('an escalation outranks a newer ordinary firing', () => {
  // Escalation is the one case where urgency beats recency: it is ringing now.
  const escalated = firing('escalated', '2026-08-01T09:00:00.000Z', 'ESCALATED')
  const fresh = firing('fresh', '2026-08-01T17:00:00.000Z')
  assert.deepEqual(order([fresh, escalated]), ['escalated', 'fresh'])
})

test('escalations are themselves ordered most recent first', () => {
  const older = firing('older', '2026-08-01T09:00:00.000Z', 'ESCALATED')
  const newer = firing('newer', '2026-08-01T12:00:00.000Z', 'ESCALATED')
  assert.deepEqual(order([older, newer]), ['newer', 'older'])
})

test('a firing that has not fired yet falls back to its scheduled time', () => {
  // A snoozed occurrence revived by the sweep keeps its original firedAt; one that
  // somehow carries none must still sort, not land at NaN and freeze the order.
  const noFiredAt = firing('none', null)
  const fired = firing('fired', '2026-08-01T09:00:00.000Z')
  assert.deepEqual(order([noFiredAt, fired]), ['fired', 'none'])
})
