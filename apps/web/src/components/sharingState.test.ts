import assert from 'node:assert/strict'
import test from 'node:test'
import { sharingState } from './sharingState.js'

test('card sharing marker distinguishes access from a pending invitation', () => {
  assert.equal(sharingState({ shareCount: 0, invitationCount: 0 }), undefined)
  assert.equal(sharingState({ shareCount: 0, invitationCount: 1 }), 'invited')
  assert.equal(sharingState({ shareCount: 2, invitationCount: 1 }), 'shared')
})
