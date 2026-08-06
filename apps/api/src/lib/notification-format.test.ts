import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escalationEmailText, notificationBody } from './notification-format.js'

type EmailReminder = Parameters<typeof escalationEmailText>[0]

function reminder(overrides: Partial<EmailReminder> = {}): EmailReminder {
  return {
    title: 'Evening meds',
    details: null,
    type: 'NONE',
    typeData: {},
    escalateEmailMessage: null,
    ...overrides
  } as EmailReminder
}

test('falls back to a default covering message when the user wrote none', () => {
  assert.equal(
    escalationEmailText(reminder()),
    'The reminder "Evening meds" is overdue and hasn\'t been confirmed.'
  )
})

test("appends the reminder's body so the recipient sees what is overdue", () => {
  const text = escalationEmailText(reminder({ details: 'Take with food', escalateEmailMessage: 'Please check on Sam.' }))
  assert.equal(text, 'Please check on Sam.\n\nTake with food')
})

test('multi-line details keep their line breaks in the plain-text email', () => {
  const text = escalationEmailText(reminder({ details: 'Blue pill\nGreen pill\nCall the clinic' }))
  assert.match(text, /\n\nBlue pill\nGreen pill\nCall the clinic$/)
})

test('medications are included for a medication reminder', () => {
  const med = reminder({
    type: 'MEDICATION',
    typeData: { medications: [{ name: 'Insulin', quantity: 10, unit: 'units' }] },
    details: 'Before breakfast'
  })
  assert.equal(notificationBody(med), 'Insulin 10 units · Before breakfast')
  assert.match(escalationEmailText(med), /\n\nInsulin 10 units · Before breakfast$/)
})

test('a checklist is listed one item per line, so BigTextStyle and email both read as a list', () => {
  const todo = reminder({
    type: 'TODO',
    typeData: { items: [{ id: 'a', text: 'Vitamins' }, { id: 'b', text: 'Inhaler' }] },
    details: 'Before leaving'
  })
  // Newline-joined, not the usual ' · ': a middle dot would read as part of the
  // last item rather than as a separate line of body text.
  assert.equal(notificationBody(todo), '• Vitamins\n• Inhaler\nBefore leaving')
  assert.match(escalationEmailText(todo), /\n\n• Vitamins\n• Inhaler\nBefore leaving$/)
})

test('a ticked item drops off the notification — a nag lists what is left to do', () => {
  const todo = reminder({
    type: 'TODO',
    typeData: { items: [{ id: 'a', text: 'Vitamins' }, { id: 'b', text: 'Inhaler' }] }
  })
  assert.equal(notificationBody(todo, ['a']), '• Inhaler')
  // The escalation email is a snapshot of what the contact would be chasing.
  assert.match(escalationEmailText(todo, ['a']), /\n\n• Inhaler$/)
})

test('a fully-ticked checklist leaves no body — the firing still needs Done', () => {
  const todo = reminder({ type: 'TODO', typeData: { items: [{ id: 'a', text: 'Vitamins' }] } })
  assert.equal(notificationBody(todo, ['a']), '')
  // Message alone, with no trailing blank lines, exactly as a body-less reminder.
  assert.equal(escalationEmailText(todo, ['a']), 'The reminder "Evening meds" is overdue and hasn\'t been confirmed.')
})

test('a tick left behind by a since-deleted item hides nothing', () => {
  const todo = reminder({ type: 'TODO', typeData: { items: [{ id: 'a', text: 'Vitamins' }] } })
  assert.equal(notificationBody(todo, ['gone']), '• Vitamins')
})

test('a checklist on a non-TODO reminder is not described (the type selects the body)', () => {
  const stray = reminder({ type: 'NONE', typeData: { items: [{ id: 'a', text: 'Vitamins' }] }, details: 'Go' })
  assert.equal(notificationBody(stray), 'Go')
})

test('a reminder with no body sends the message alone (no trailing blank lines)', () => {
  const text = escalationEmailText(reminder({ escalateEmailMessage: '  Check on Sam.  ' }))
  assert.equal(text, 'Check on Sam.')
})
