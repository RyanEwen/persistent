import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reminderBodyText, reminderInputSchema, todoItems, todoProgress } from './reminders.js'

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

// --- Monthly schedules -------------------------------------------------------

test('monthly parses with days of the month', () => {
  const parsed = reminderInputSchema.parse({
    ...base,
    schedule: { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1, 15] }
  })
  assert.deepEqual(parsed.schedule.daysOfMonth, [1, 15])
})

test('monthly accepts "last day of the month" with no numbered day', () => {
  // "The last day" is a complete schedule on its own — there is no number to pick.
  const parsed = reminderInputSchema.parse({
    ...base,
    schedule: { kind: 'monthly', timesOfDay: ['09:00'], lastDayOfMonth: true }
  })
  assert.equal(parsed.schedule.lastDayOfMonth, true)
})

test('monthly with neither a day nor the last day is rejected', () => {
  const result = reminderInputSchema.safeParse({ ...base, schedule: { kind: 'monthly', timesOfDay: ['09:00'] } })
  assert.equal(result.success, false)
})

test('a day of the month outside 1-31 is rejected', () => {
  for (const day of [0, 32]) {
    const result = reminderInputSchema.safeParse({
      ...base,
      schedule: { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [day] }
    })
    assert.equal(result.success, false, `day ${day} should be rejected`)
  }
})

// --- Checklist (TODO) reminders ----------------------------------------------

const todoBase = { ...base, type: 'TODO' as const }

test('a checklist reminder parses with items', () => {
  const parsed = reminderInputSchema.parse({
    ...todoBase,
    typeData: { items: [{ id: 'a', text: 'Vitamins' }, { id: 'b', text: 'Inhaler' }] }
  })
  assert.deepEqual(todoItems(parsed.typeData).map((i) => i.text), ['Vitamins', 'Inhaler'])
})

test('a checklist reminder with no items is rejected', () => {
  // A TODO with nothing to tick is just a reminder — say so rather than saving a
  // type whose whole point is the list.
  assert.equal(reminderInputSchema.safeParse({ ...todoBase, typeData: {} }).success, false)
})

test('duplicate item ids are rejected — one tick must never mark two items', () => {
  const result = reminderInputSchema.safeParse({
    ...todoBase,
    typeData: { items: [{ id: 'a', text: 'Vitamins' }, { id: 'a', text: 'Inhaler' }] }
  })
  assert.equal(result.success, false)
})

test('a non-TODO reminder is unaffected by the checklist rules', () => {
  assert.equal(reminderInputSchema.safeParse({ ...base, type: 'MEDICATION', typeData: {} }).success, true)
})

test('the removed TASK / APPOINTMENT types are rejected', () => {
  // They only ever changed an icon, so they were dropped and existing rows fell
  // back to NONE; a client still sending one should fail loudly, not silently.
  for (const type of ['TASK', 'APPOINTMENT']) {
    assert.equal(reminderInputSchema.safeParse({ ...base, type }).success, false, `${type} should be rejected`)
  }
})

test('progress ignores ticks left behind by a deleted item', () => {
  // Editing the reminder can remove an item an in-flight firing had already
  // ticked; that stale id must not push "done" past the number of items.
  const items = [{ id: 'a', text: 'Vitamins' }]
  assert.deepEqual(todoProgress(items, ['a', 'gone']), { done: 1, total: 1 })
})

test('a body with a checklist keeps one item per line', () => {
  const body = reminderBodyText({
    type: 'TODO',
    typeData: { items: [{ id: 'a', text: 'Milk' }, { id: 'b', text: 'Bread' }] },
    details: 'From the corner shop'
  })
  assert.equal(body, '• Milk\n• Bread\nFrom the corner shop')
})

// --- Notes (schedule kind `never`) -------------------------------------------

test('a note parses with no times of day', () => {
  const parsed = reminderInputSchema.parse({ ...base, schedule: { kind: 'never', timesOfDay: [] } })
  assert.equal(parsed.schedule.kind, 'never')
  assert.deepEqual(parsed.schedule.timesOfDay, [])
})

test('a note rejects a time of day', () => {
  // `never` means no firing at all; a time would claim one.
  const result = reminderInputSchema.safeParse({ ...base, schedule: { kind: 'never', timesOfDay: ['08:00'] } })
  assert.equal(result.success, false)
})

test('a note rejects escalation — there is no firing for anyone to ignore', () => {
  const note = { kind: 'never' as const, timesOfDay: [] }
  for (const escalation of [
    { escalateAfterMinutes: 15 },
    { escalateAtTime: '09:00' },
    { escalateEmail: 'someone@example.com', escalateEmailAfterMinutes: 60 }
  ]) {
    const result = reminderInputSchema.safeParse({ ...base, schedule: note, ...escalation })
    assert.equal(result.success, false, `${JSON.stringify(escalation)} should be rejected on a note`)
  }
})

test('a note still accepts the reminder fields it does use', () => {
  const parsed = reminderInputSchema.parse({
    ...base,
    title: 'Wifi password',
    details: 'hunter2',
    schedule: { kind: 'never', timesOfDay: [] }
  })
  assert.equal(parsed.details, 'hunter2')
})
