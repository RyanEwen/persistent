import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStaleWrite } from './conflict.js'

const base = new Date('2026-06-21T12:00:00.000Z')

test('an edit older than the stored version is stale', () => {
  assert.equal(isStaleWrite('2026-06-21T11:59:00.000Z', base), true)
})

test('an edit newer than the stored version applies', () => {
  assert.equal(isStaleWrite('2026-06-21T12:00:01.000Z', base), false)
})

test('an edit equal to the stored version applies (not stale)', () => {
  assert.equal(isStaleWrite('2026-06-21T12:00:00.000Z', base), false)
})

test('missing or invalid timestamps are treated as not stale', () => {
  assert.equal(isStaleWrite(null, base), false)
  assert.equal(isStaleWrite(undefined, base), false)
  assert.equal(isStaleWrite('not-a-date', base), false)
})
