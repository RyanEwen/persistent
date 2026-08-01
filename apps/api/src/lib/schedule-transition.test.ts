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
