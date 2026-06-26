import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_SNOOZE_MINUTES } from '@persistent/shared'
import { minutesUntilDateTime, toDateTimeLocalValue, customToMinutes } from './durations.js'

test('minutesUntilDateTime: forward delta for a future local datetime', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(minutesUntilDateTime('2026-06-25T09:30', from), 90)
})

test('minutesUntilDateTime: supports dates more than a day out', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(minutesUntilDateTime('2026-06-28T08:00', from), 3 * 24 * 60)
})

test('minutesUntilDateTime: a past datetime floors at 1', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(minutesUntilDateTime('2026-06-24T08:00', from), 1)
})

test('minutesUntilDateTime: clamps to the snooze ceiling', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(minutesUntilDateTime('2030-06-25T08:00', from), MAX_SNOOZE_MINUTES)
})

test('minutesUntilDateTime: malformed input falls back to 1', () => {
  assert.equal(minutesUntilDateTime('not-a-datetime'), 1)
})

test('toDateTimeLocalValue: zero-pads to the input format', () => {
  assert.equal(toDateTimeLocalValue(new Date('2026-03-04T05:06:00')), '2026-03-04T05:06')
})

test('customToMinutes: converts unit and floors at 1', () => {
  assert.equal(customToMinutes(2, 'hrs'), 120)
  assert.equal(customToMinutes(0, 'mins'), 1)
})
