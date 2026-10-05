import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSession } from './loadSession.js'

const saved = { id: 'owner', email: 'owner@example.com', displayName: null, timeZone: 'America/Toronto', createdAt: '2026-10-02T12:00:00Z' }

test('offline startup uses saved identity without attempting a network request', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch') })
  assert.deepEqual(await loadSession(saved, false), { user: saved, offline: true })
  assert.deepEqual(await loadSession(null, false), { user: null, offline: true })
  assert.equal(fetch.mock.callCount(), 0)
})

test('transport failure permits offline access but HTTP rejection and malformed sessions do not', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  assert.deepEqual(await loadSession(saved, true), { user: saved, offline: true })
  fetch.mock.mockImplementation(async () => new Response('{"error":"Unavailable"}', { status: 503 }))
  await assert.rejects(loadSession(saved, true), /Unavailable/)
  fetch.mock.mockImplementation(async () => new Response('{"user":{"id":"invalid"}}', { status: 200 }))
  await assert.rejects(loadSession(saved, true))
})

test('server sign-out is authoritative even with an offline identity saved', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('{"user":null}', { status: 200 }))
  assert.deepEqual(await loadSession(saved, true), { user: null, offline: false })
})

test('cancellation is never mistaken for permission to reopen offline', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Cancelled', 'AbortError') })
  await assert.rejects(loadSession(saved, true), { name: 'AbortError' })
})
