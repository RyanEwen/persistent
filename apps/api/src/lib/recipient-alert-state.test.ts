import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecipientAlertState, ReminderOccurrence } from '@prisma/client'
import { occurrenceForActor } from './recipient-alert-state.js'

const until = new Date('2026-09-26T15:00:00.000Z')
const firedAt = new Date('2026-09-26T14:00:00.000Z')
const occurrence = {
  userId: 'owner',
  status: 'SNOOZED',
  firedAt,
  lastNotifiedAt: until,
  snoozedUntil: until,
  escalatedAt: null,
  escalationSilencedAt: null
} as ReminderOccurrence

test('owner snooze does not snooze a recipient', () => {
  const owner = occurrenceForActor(occurrence, 'owner', null)
  const recipient = occurrenceForActor(occurrence, 'recipient', null)
  assert.equal(owner.status, 'SNOOZED')
  assert.equal(recipient.status, 'FIRED')
  assert.equal(recipient.snoozedUntil, null)
  assert.equal(recipient.lastNotifiedAt, firedAt)
})

test('recipient snooze is personal, while Done is shared', () => {
  const state = { snoozedUntil: until, escalatedAt: null, escalationSilencedAt: null, lastNotifiedAt: null } as RecipientAlertState
  assert.equal(occurrenceForActor(occurrence, 'recipient', state).status, 'SNOOZED')
  assert.equal(occurrenceForActor({ ...occurrence, status: 'ACKNOWLEDGED' }, 'recipient', state).status, 'ACKNOWLEDGED')
})
