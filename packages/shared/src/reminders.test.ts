import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reminderInputSchema } from './reminders.js'

const base = {
  title: 'Test',
  schedule: { kind: 'once' as const, timesOfDay: ['08:00'] },
  startDate: '2026-06-24'
}

test('shadeProminence defaults to INHERIT when omitted', () => {
  const parsed = reminderInputSchema.parse(base)
  assert.equal(parsed.shadeProminence, 'INHERIT')
})

test('shadeProminence accepts NORMAL and MINIMIZED', () => {
  assert.equal(reminderInputSchema.parse({ ...base, shadeProminence: 'NORMAL' }).shadeProminence, 'NORMAL')
  assert.equal(reminderInputSchema.parse({ ...base, shadeProminence: 'MINIMIZED' }).shadeProminence, 'MINIMIZED')
})

test('shadeProminence rejects unknown values', () => {
  assert.equal(reminderInputSchema.safeParse({ ...base, shadeProminence: 'LOUD' }).success, false)
})

// --- Unscheduled ("no date or time") reminders -------------------------------

test('an unscheduled reminder parses with no times of day', () => {
  const parsed = reminderInputSchema.parse({ ...base, schedule: { kind: 'none', timesOfDay: [] } })
  assert.equal(parsed.schedule.kind, 'none')
  assert.deepEqual(parsed.schedule.timesOfDay, [])
})

test('an unscheduled reminder rejects a time of day', () => {
  // 'none' means no wall-clock firing at all; carrying a time would be ambiguous.
  const result = reminderInputSchema.safeParse({ ...base, schedule: { kind: 'none', timesOfDay: ['08:00'] } })
  assert.equal(result.success, false)
})

test('every other kind still requires at least one time of day', () => {
  for (const kind of ['once', 'daily'] as const) {
    const result = reminderInputSchema.safeParse({ ...base, schedule: { kind, timesOfDay: [] } })
    assert.equal(result.success, false, `${kind} should require a time of day`)
  }
})
