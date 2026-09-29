import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snoozeUntilInput, toDateTimeLocalValue, customToMinutes } from './durations.js'

test('snoozeUntilInput: preserves the selected minute despite nonzero seconds now', () => {
  const from = new Date('2026-06-25T08:00:45')
  assert.deepEqual(snoozeUntilInput('2026-06-25T09:30', from), {
    until: new Date('2026-06-25T09:30:00').toISOString()
  })
})

test('snoozeUntilInput: supports dates more than a day out', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.deepEqual(snoozeUntilInput('2026-06-28T08:00', from), {
    until: new Date('2026-06-28T08:00:00').toISOString()
  })
})

test('snoozeUntilInput: rejects a past datetime', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(snoozeUntilInput('2026-06-24T08:00', from), null)
})

test('snoozeUntilInput: rejects dates past the snooze ceiling', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(snoozeUntilInput('2030-06-25T08:00', from), null)
})

test('snoozeUntilInput: malformed input is not submitted', () => {
  assert.equal(snoozeUntilInput('not-a-datetime'), null)
})

test('toDateTimeLocalValue: zero-pads to the input format', () => {
  assert.equal(toDateTimeLocalValue(new Date('2026-03-04T05:06:00')), '2026-03-04T05:06')
})

test('customToMinutes: converts unit and floors at 1', () => {
  assert.equal(customToMinutes(2, 'hrs'), 120)
  assert.equal(customToMinutes(0, 'mins'), 1)
})
