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
    type: 'NONE',
    typeData: {},
    persistence: 'PERSISTENT',
    soundIntervalSeconds: 0,
    shadeProminence: 'INHERIT',
    sounds: {},
    ...overrides
  } as unknown as Reminder
}

const TONES = {
  notification: { uri: 'content://media/1', title: 'Chime' },
  nag: { uri: 'content://media/2', title: 'Bell' },
  alarm: { uri: 'content://media/3', title: 'Argon' }
}

function occurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'occ1',
    reminderId: 'rem1',
    status: 'FIRED',
    scheduledFor,
    snoozedUntil: null,
    escalatedAt: null,
    escalationSilencedAt: null,
    checkedItems: [],
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
  const alarms = buildDeviceAlarms(occurrence({ status: 'ESCALATED', escalatedAt: escalateAt }), escalateAt)
  assert.equal(alarms.length, 1)
  assert.equal(alarms[0]!.alarm, true)
  assert.equal(alarms[0]!.canSilence, true) // soft reminder escalated -> silenceable
})

// --- Snoozing an alarm snoozes the ALARM (docs/notification-behavior.md §3) -----

test('snoozing an escalated firing brings the alarm back, not a soft nag', () => {
  // The regression this guards: `status` is SNOOZED for the duration, so reading it
  // alone re-armed a notification and dropped the escalation alarm (whose instant is
  // behind the snooze) — the snooze quietly de-escalated the firing on-device.
  const snoozedUntil = new Date(scheduledFor.getTime() + 30 * 60_000)
  const alarms = buildDeviceAlarms(
    occurrence({
      status: 'SNOOZED',
      snoozedUntil,
      escalatedAt: new Date(scheduledFor.getTime() + 15 * 60_000)
    }),
    null
  )
  assert.equal(alarms.length, 1)
  assert.equal(alarms[0]!.fireAtMs, snoozedUntil.getTime())
  assert.equal(alarms[0]!.alarm, true)
  assert.equal(alarms[0]!.soundKind, 'alarm')
  // It has to be quietenable on the way back, or the ring has no way out.
  assert.equal(alarms[0]!.canSilence, true)
})

test('a silenced escalation stays silent across a snooze', () => {
  // Silence is "stop yelling, keep reminding me" — for this firing, for good.
  const snoozedUntil = new Date(scheduledFor.getTime() + 30 * 60_000)
  const alarms = buildDeviceAlarms(
    occurrence({
      status: 'SNOOZED',
      snoozedUntil,
      escalatedAt: new Date(scheduledFor.getTime() + 15 * 60_000),
      escalationSilencedAt: new Date(scheduledFor.getTime() + 16 * 60_000)
    }),
    null
  )
  assert.equal(alarms.length, 1)
  assert.equal(alarms[0]!.alarm, false)
  assert.equal(alarms[0]!.canSilence, false)
})

test('a snooze that outlasts a pending escalation returns escalated', () => {
  // Same rule the server sweep applies: escalateAt is anchored to the first fire and
  // never reset by a snooze, so once it is behind the return time the firing returns
  // ringing rather than as a nag the sweep has to escalate a minute later.
  const escalateAt = new Date(scheduledFor.getTime() + 15 * 60_000)
  const snoozedUntil = new Date(scheduledFor.getTime() + 30 * 60_000)
  const alarms = buildDeviceAlarms(occurrence({ status: 'SNOOZED', snoozedUntil }), escalateAt)
  assert.equal(alarms.length, 1) // no second ::esc alarm — this one already rings
  assert.equal(alarms[0]!.alarm, true)
  assert.equal(alarms[0]!.canSilence, true)
})

test('a snooze that ends before a pending escalation still returns as a nag', () => {
  // The escalation is still ahead, so it rides its own ::esc alarm as usual.
  const escalateAt = new Date(scheduledFor.getTime() + 60 * 60_000)
  const snoozedUntil = new Date(scheduledFor.getTime() + 30 * 60_000)
  const alarms = buildDeviceAlarms(occurrence({ status: 'SNOOZED', snoozedUntil }), escalateAt)
  assert.equal(alarms.length, 2)
  assert.equal(alarms[0]!.alarm, false)
  assert.equal(alarms[1]!.fireAtMs, escalateAt.getTime())
  assert.equal(alarms[1]!.alarm, true)
})

test("an armed alarm's body lists only the checklist items this firing has left", () => {
  const todo = reminder({
    type: 'TODO',
    typeData: { items: [{ id: 'a', text: 'Vitamins' }, { id: 'b', text: 'Inhaler' }] }
  })
  const alarms = buildDeviceAlarms(occurrence({ reminder: todo, checkedItems: ['a'] }), null)
  assert.equal(alarms[0]!.body, '• Inhaler')
})

test('ticking the last item leaves a body-less nag — it still needs Done', () => {
  const todo = reminder({ type: 'TODO', typeData: { items: [{ id: 'a', text: 'Vitamins' }] } })
  const alarms = buildDeviceAlarms(occurrence({ reminder: todo, checkedItems: ['a'] }), null)
  assert.equal(alarms.length, 1)
  assert.equal(alarms[0]!.body, '')
})

// --- The reminder's own tones ------------------------------------------------

test('a reminder that overrides nothing sends no tones, leaving the device its own', () => {
  const [main] = buildDeviceAlarms(occurrence(), null)
  assert.equal(main!.sound, null)
  assert.equal(main!.nagSound, null)
})

test('a soft nag carries the reminder’s notification tone and its nag tone', () => {
  const alarms = buildDeviceAlarms(occurrence({ reminder: reminder({ sounds: TONES }) }), null)
  assert.deepEqual(alarms[0]!.sound, TONES.notification)
  assert.deepEqual(alarms[0]!.nagSound, TONES.nag)
})

test('a ringing alarm carries the alarm tone and no nag tone', () => {
  // An alarm loops one continuous tone — there is no follow-up to re-tone.
  const alarms = buildDeviceAlarms(occurrence({ reminder: reminder({ persistence: 'ALARM', sounds: TONES }) }), null)
  assert.deepEqual(alarms[0]!.sound, TONES.alarm)
  assert.equal(alarms[0]!.nagSound, null)
})

test('the ::esc twin takes the alarm tone, not the notification tone it was cloned from', () => {
  // The escalation is built by spreading the main (soft) alarm, so the tones have to
  // be re-asked rather than inherited: an escalation rings, so it is the alarm tone.
  const escalateAt = new Date(scheduledFor.getTime() + 15 * 60_000)
  const alarms = buildDeviceAlarms(occurrence({ reminder: reminder({ sounds: TONES }) }), escalateAt)
  assert.equal(alarms.length, 2)
  assert.deepEqual(alarms[0]!.sound, TONES.notification)
  assert.deepEqual(alarms[1]!.sound, TONES.alarm)
  assert.equal(alarms[1]!.nagSound, null)
})

test('an escalated firing rings in the alarm tone even though its status came back SNOOZED', () => {
  const snoozedUntil = new Date(scheduledFor.getTime() + 30 * 60_000)
  const alarms = buildDeviceAlarms(
    occurrence({
      status: 'SNOOZED',
      snoozedUntil,
      escalatedAt: new Date(scheduledFor.getTime() + 15 * 60_000),
      reminder: reminder({ sounds: TONES })
    }),
    null
  )
  assert.deepEqual(alarms[0]!.sound, TONES.alarm)
})
