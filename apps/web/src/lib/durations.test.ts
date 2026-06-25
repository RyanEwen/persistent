import { test } from 'node:test'
import assert from 'node:assert/strict'
import { minutesUntilTime, customToMinutes } from './durations.js'

test('minutesUntilTime: later today returns the forward delta', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(minutesUntilTime('09:30', from), 90)
})

test('minutesUntilTime: a passed time rolls to tomorrow', () => {
  const from = new Date('2026-06-25T08:00:00')
  // 07:00 already passed -> next 07:00 is 23h from now.
  assert.equal(minutesUntilTime('07:00', from), 23 * 60)
})

test('minutesUntilTime: the same minute rolls a full day, never zero', () => {
  const from = new Date('2026-06-25T08:00:00')
  assert.equal(minutesUntilTime('08:00', from), 1440)
})

test('minutesUntilTime: clamps to the 1-day snooze ceiling', () => {
  const from = new Date('2026-06-25T08:00:30')
  // 08:01 is just under a minute away -> rounds up but never below the floor.
  assert.ok(minutesUntilTime('08:01', from) >= 1)
  assert.ok(minutesUntilTime('07:59', from) <= 1440)
})

test('minutesUntilTime: malformed input falls back to 1', () => {
  assert.equal(minutesUntilTime('not-a-time'), 1)
})

test('customToMinutes: converts unit and floors at 1', () => {
  assert.equal(customToMinutes(2, 'hrs'), 120)
  assert.equal(customToMinutes(0, 'mins'), 1)
})
