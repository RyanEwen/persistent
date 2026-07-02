import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Reminder } from '@prisma/client'
import { ESC_SUFFIX } from '@persistent/shared'
import { buildDeviceAlarms } from './device-alarms.js'

const scheduledFor = new Date('2026-07-01T12:00:00.000Z')

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    title: 'Take meds',
    details: null,
    category: 'NONE',
    categoryData: {},
    persistence: 'PERSISTENT',
    soundIntervalSeconds: 0,
    shadeProminence: 'INHERIT',
    ...overrides
  } as unknown as Reminder
}

function occurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'occ1',
    reminderId: 'rem1',
    status: 'FIRED',
    scheduledFor,
    snoozedUntil: null,
    reminder: reminder(),
    ...overrides
  } as Parameters<typeof buildDeviceAlarms>[0]
}

test('a plain PERSISTENT occurrence yields one notification alarm', () => {
  const alarms = buildDeviceAlarms(occurrence(), null)
  assert.equal(alarms.length, 1)
  const [main] = alarms
  assert.equal(main!.occurrenceId, 'occ1')
  assert.equal(main!.alarm, false)
  assert.equal(main!.soundKind, 'notification')
  assert.equal(main!.canSilence, false)
  assert.equal(main!.fireAtMs, scheduledFor.getTime())
})

test('ALARM persistence rings (alarm tone)', () => {
  const alarms = buildDeviceAlarms(occurrence({ reminder: reminder({ persistence: 'ALARM' }) }), null)
  assert.equal(alarms[0]!.alarm, true)
  assert.equal(alarms[0]!.soundKind, 'alarm')
})

test('a pending escalation adds a second ::esc alarm at the escalation instant', () => {
  const escalateAt = new Date(scheduledFor.getTime() + 15 * 60_000)
  const alarms = buildDeviceAlarms(occurrence(), escalateAt)
  assert.equal(alarms.length, 2)
  const esc = alarms[1]!
  assert.equal(esc.occurrenceId, 'occ1' + ESC_SUFFIX)
  assert.equal(esc.fireAtMs, escalateAt.getTime())
  assert.equal(esc.alarm, true)
  assert.equal(esc.canSilence, true)
})

test('escalation never rings before the main fire (the ~22h-early guard)', () => {
  const escalateAt = new Date(scheduledFor.getTime() - 60_000) // before fire
  const alarms = buildDeviceAlarms(occurrence(), escalateAt)
  assert.equal(alarms.length, 1)
})

test('a snoozed occurrence fires at snoozedUntil, not the scheduled time', () => {
  const snoozedUntil = new Date(scheduledFor.getTime() + 30 * 60_000)
  const alarms = buildDeviceAlarms(occurrence({ status: 'SNOOZED', snoozedUntil }), null)
  assert.equal(alarms[0]!.fireAtMs, snoozedUntil.getTime())
})

test('an already-escalated occurrence rings and adds no future escalation alarm', () => {
  const escalateAt = new Date(scheduledFor.getTime() + 15 * 60_000)
  const alarms = buildDeviceAlarms(occurrence({ status: 'ESCALATED' }), escalateAt)
  assert.equal(alarms.length, 1)
  assert.equal(alarms[0]!.alarm, true)
  assert.equal(alarms[0]!.canSilence, true) // soft reminder escalated -> silenceable
})
