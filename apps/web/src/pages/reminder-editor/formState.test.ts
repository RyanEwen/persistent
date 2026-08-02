import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyForm, fromReminder, isFormDirty, toInput, type FormState } from './formState.js'
import type { Reminder, Schedule } from '@persistent/shared'

function form(overrides: Partial<FormState> = {}): FormState {
  return { ...emptyForm(), ...overrides }
}

test('an untouched form is not dirty', () => {
  const original = form()
  assert.equal(isFormDirty(original, { ...original }), false)
})

test('editing the title is dirty', () => {
  const original = form({ title: 'Water plants' })
  assert.equal(isFormDirty(original, { ...original, title: 'Water the plants' }), true)
})

test('editing a checklist item is dirty', () => {
  const original = form({ type: 'TODO', todos: [{ id: 'a', text: 'Milk' }] })
  assert.equal(isFormDirty(original, { ...original, todos: [{ id: 'a', text: 'Oat milk' }] }), true)
})

test('reordering checklist items is dirty', () => {
  const original = form({ type: 'TODO', todos: [{ id: 'a', text: 'Milk' }, { id: 'b', text: 'Bread' }] })
  const reordered = { ...original, todos: [original.todos[1]!, original.todos[0]!] }
  assert.equal(isFormDirty(original, reordered), true)
})

test('fields the chosen type does not save are not a change', () => {
  // Typed a medication, then switched the reminder to a plain one: the rows are
  // still in form state but no longer saved, so leaving loses nothing.
  const original = form({ type: 'NONE' })
  const strayMedication = { ...original, medications: [{ name: 'Ibuprofen', unit: 'mg', quantity: '200' }] }
  assert.equal(isFormDirty(original, strayMedication), false)
})

test('weekday choices left behind by a schedule that no longer uses them are not a change', () => {
  const original = form({ when: 'scheduled', kind: 'daily' })
  assert.equal(isFormDirty(original, { ...original, daysOfWeek: [0, 6] }), false)
})

test('a schedule change that does get saved is dirty', () => {
  const original = form({ when: 'scheduled', kind: 'weekly', daysOfWeek: [1] })
  assert.equal(isFormDirty(original, { ...original, daysOfWeek: [1, 3] }), true)
})

// --- Notes (When = Never) ----------------------------------------------------

/** A saved reminder, enough of one for the two conversions to round-trip it. */
function reminder(schedule: Schedule, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    title: 'Wifi password',
    details: 'hunter2',
    type: 'NONE',
    typeData: {},
    schedule,
    persistence: 'PERSISTENT',
    soundIntervalSeconds: null,
    shadeProminence: 'INHERIT',
    escalateAfterMinutes: null,
    escalateAtTime: null,
    escalateEmail: null,
    escalateEmailMessage: null,
    escalateEmailAfterMinutes: null,
    active: true,
    startDate: '2026-08-02',
    endDate: null,
    lastOccurrence: null,
    createdAt: '2026-08-02T09:00:00.000Z',
    updatedAt: '2026-08-02T09:00:00.000Z',
    ...overrides
  }
}

test('a note saves as the `never` schedule, with no time of day', () => {
  const input = toInput(form({ when: 'never', timesOfDay: ['08:00'], kind: 'daily' }))
  assert.equal(input.schedule.kind, 'never')
  assert.deepEqual(input.schedule.timesOfDay, [])
})

test('a note round-trips through the editor as a note', () => {
  // The bug this guards is the one `none` had before it was a real stored kind:
  // reopening a note must not show it as something that fires.
  const state = fromReminder(reminder({ kind: 'never', timesOfDay: [] }))
  assert.equal(state.when, 'never')
  assert.equal(toInput(state).schedule.kind, 'never')
})

test('a note drops escalation rather than saving a promise nothing can keep', () => {
  const input = toInput(
    form({
      when: 'never',
      escalate: true,
      escalateAfterMinutes: '15',
      escalateEmailEnabled: true,
      escalateEmail: 'someone@example.com'
    })
  )
  assert.equal(input.escalateAfterMinutes, null)
  assert.equal(input.escalateAtTime, null)
  assert.equal(input.escalateEmail, null)
  assert.equal(input.escalateEmailAfterMinutes, null)
})

test('a note has no end date — there is no run of firings to stop', () => {
  assert.equal(toInput(form({ when: 'never', endDate: '2026-12-31' })).endDate, null)
})

test('a note keeps the repeat the user had picked, ready for it to fire again', () => {
  // `kind` is remembered while When is Never, so switching back to Schedule it
  // lands on the weekly schedule that was set up rather than resetting it.
  const state = form({ when: 'never', kind: 'weekly', daysOfWeek: [1, 3] })
  const scheduled = toInput({ ...state, when: 'scheduled' })
  assert.equal(scheduled.schedule.kind, 'weekly')
  assert.deepEqual(scheduled.schedule.daysOfWeek, [1, 3])
})

test('switching a firing reminder to a note is a change worth stopping for', () => {
  const original = form({ when: 'scheduled', kind: 'daily' })
  assert.equal(isFormDirty(original, { ...original, when: 'never' }), true)
})
