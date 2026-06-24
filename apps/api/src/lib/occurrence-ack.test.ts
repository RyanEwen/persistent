import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ackDecision } from './occurrence-ack.js'

const now = new Date('2026-06-24T03:45:30.000Z')
const due = new Date('2026-06-24T03:45:00.000Z') // already past `now`
const future = new Date('2026-06-25T03:45:00.000Z') // tomorrow's firing

test('a nagging occurrence (FIRED/SNOOZED/ESCALATED) applies the ack', () => {
  assert.equal(ackDecision('FIRED', future, now), 'apply')
  assert.equal(ackDecision('SNOOZED', future, now), 'apply')
  assert.equal(ackDecision('ESCALATED', future, now), 'apply')
})

test('re-acking an already-acknowledged occurrence is an idempotent no-op', () => {
  assert.equal(ackDecision('ACKNOWLEDGED', due, now), 'noop')
})

test('acking a PENDING occurrence that is already due applies (native alarm fired before the server tick)', () => {
  assert.equal(ackDecision('PENDING', due, now), 'apply')
  assert.equal(ackDecision('PENDING', now, now), 'apply') // exactly due
})

test('acking a not-yet-due PENDING occurrence is rejected (it would silently cancel the firing)', () => {
  assert.equal(ackDecision('PENDING', future, now), 'reject')
})

test('acking a terminal occurrence (SUPERSEDED/MISSED) is rejected', () => {
  assert.equal(ackDecision('SUPERSEDED', due, now), 'reject')
  assert.equal(ackDecision('MISSED', due, now), 'reject')
})
