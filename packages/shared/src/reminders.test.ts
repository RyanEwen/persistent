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
