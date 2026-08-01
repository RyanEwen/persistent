import test from 'node:test'
import assert from 'node:assert/strict'
import type { Occurrence, OccurrenceStatus } from '@persistent/shared'
import { compareFirings } from './firingOrder.js'

function firing(id: string, lastNotifiedAt: string | null, status: OccurrenceStatus = 'FIRED'): Occurrence {
  // scheduledFor deliberately differs, so a test that passes by reading the wrong
  // field would order things backwards.
  return {
    id,
    status,
    lastNotifiedAt,
    firedAt: lastNotifiedAt,
    scheduledFor: '2020-01-01T00:00:00.000Z'
  } as Occurrence
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

test('a revived snooze sorts by when it came back, not its first fire', () => {
  // The sweep keeps firedAt anchored to the first fire (the escalation backstop
  // depends on it) and stamps lastNotifiedAt instead. Ordering must follow the
  // stamp, or a snooze that just reappeared sits below things older than it.
  const revived = {
    id: 'revived',
    status: 'FIRED',
    firedAt: '2026-08-01T09:00:00.000Z',
    lastNotifiedAt: '2026-08-01T17:00:00.000Z',
    scheduledFor: '2026-08-01T09:00:00.000Z'
  } as Occurrence
  const midday = firing('midday', '2026-08-01T12:00:00.000Z')
  assert.deepEqual(order([revived, midday]), ['revived', 'midday'])
})

test('a row with no timestamps at all still sorts', () => {
  // Rows written before lastNotifiedAt existed, and anything not yet fired: these
  // must fall back rather than land at NaN and freeze the comparator.
  const bare = { id: 'bare', status: 'FIRED', scheduledFor: '2020-01-01T00:00:00.000Z' } as Occurrence
  const fired = firing('fired', '2026-08-01T09:00:00.000Z')
  assert.deepEqual(order([bare, fired]), ['fired', 'bare'])
})
