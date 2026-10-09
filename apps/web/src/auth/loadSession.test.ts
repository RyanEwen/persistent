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


for (const failure of [new TypeError('Failed to fetch'), new DOMException('Expired request', 'TimeoutError')]) {
  test(`a fresh session request recovers after ${failure.name} without offline fallback`, async (context) => {
    const signals: AbortSignal[] = []
    const fetch = context.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, options?: RequestInit) => {
      assert.ok(options?.signal)
      signals.push(options.signal)
      if (signals.length === 1) throw failure
      return new Response(JSON.stringify({ user: saved }))
    })
    assert.deepEqual(await loadSession(saved, true), { user: saved, offline: false })
    assert.equal(fetch.mock.callCount(), 2)
    assert.notEqual(signals[0], signals[1], 'a timed-out signal must never be reused')
    assert.equal(signals[1]?.aborted, false)
  })
}

test('connection fallback is bounded to two probes with an eight-second and three-second deadline', async (context) => {
  const deadlines: number[] = []
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    deadlines.push(milliseconds)
    return new AbortController().signal
  })
  const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  assert.deepEqual(await loadSession(saved, true), { user: saved, offline: true })
  assert.equal(fetch.mock.callCount(), 2)
  assert.deepEqual(deadlines, [8_000, 3_000])
})

for (const response of [
  new Response('{"error":"Unavailable"}', { status: 503 }),
  new Response('{"user":{"id":"invalid"}}')
]) {
  test(`retry cannot turn a ${response.status} rejection or malformed session into offline access`, async (context) => {
    let calls = 0
    context.mock.method(globalThis, 'fetch', async () => {
      if (++calls === 1) throw new TypeError('Failed to fetch')
      return response
    })
    await assert.rejects(loadSession(saved, true))
    assert.equal(calls, 2)
  })
}

test('a successful retry with no server session signs out instead of restoring the saved account', async (context) => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) throw new TypeError('Failed to fetch')
    return new Response('{"user":null}')
  })
  assert.deepEqual(await loadSession(saved, true), { user: null, offline: false })
})

test('caller cancellation during a transport failure prevents retry and offline access', async (context) => {
  const controller = new AbortController()
  const fetch = context.mock.method(globalThis, 'fetch', async () => {
    controller.abort()
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(loadSession(saved, true, controller.signal), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 1)
})
