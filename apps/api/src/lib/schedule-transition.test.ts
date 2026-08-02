import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleTransition } from './schedule-transition.js'

test('giving an unscheduled reminder a schedule retires its immediate firing', () => {
  assert.equal(scheduleTransition('none', 'daily'), 'retire')
  assert.equal(scheduleTransition('none', 'once'), 'retire')
})

test('taking a reminder\'s schedule away asks for the unscheduled firing', () => {
  // The reported bug was this branch simply not existing: the reminder became
  // unscheduled, materialization minted a firing anyway, and the one its old
  // schedule had left unconfirmed stayed put — two identical cards.
  assert.equal(scheduleTransition('daily', 'none'), 'mint')
  assert.equal(scheduleTransition('monthly', 'none'), 'mint')
})

test('an edit between two real schedules touches no firing', () => {
  assert.equal(scheduleTransition('daily', 'weekly'), null)
  assert.equal(scheduleTransition('once', 'once'), null)
})

test('editing an unscheduled reminder does not re-ask to be reminded', () => {
  assert.equal(scheduleTransition('none', 'none'), null)
})

// --- Notes (schedule kind `never`) -------------------------------------------

test('turning a reminder into a note retires whatever it left nagging', () => {
  // The user has said this thing does not remind. Leaving a nag behind would
  // contradict the mode they just chose, and there is no later firing for the
  // obligation to carry forward to.
  assert.equal(scheduleTransition('daily', 'never'), 'retire')
  assert.equal(scheduleTransition('once', 'never'), 'retire')
  assert.equal(scheduleTransition('none', 'never'), 'retire')
})

test('editing a note does not run the retire pass over firings it cannot have', () => {
  assert.equal(scheduleTransition('never', 'never'), null)
})

test('giving a note a real schedule touches no firing', () => {
  // Becoming a note already cleared them, so there is nothing left to retire.
  assert.equal(scheduleTransition('never', 'daily'), null)
})

test('a note that stops being one asks for the unscheduled firing', () => {
  assert.equal(scheduleTransition('never', 'none'), 'mint')
})
