import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyForm, isFormDirty, type FormState } from './formState.js'

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
  const original = form({ scheduled: true, kind: 'daily' })
  assert.equal(isFormDirty(original, { ...original, daysOfWeek: [0, 6] }), false)
})

test('a schedule change that does get saved is dirty', () => {
  const original = form({ scheduled: true, kind: 'weekly', daysOfWeek: [1] })
  assert.equal(isFormDirty(original, { ...original, daysOfWeek: [1, 3] }), true)
})
