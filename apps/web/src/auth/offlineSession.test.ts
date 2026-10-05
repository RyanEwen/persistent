import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OFFLINE_MAX_AGE, OFFLINE_SESSION_KEY, QUERY_CACHE_KEY, readOfflineUser, saveOfflineUser } from './offlineSession.js'
import { deserializeAccountCache, serializeAccountCache } from '../lib/accountCache.js'

const user = { id: 'owner', email: 'owner@example.com', displayName: null, timeZone: 'America/Toronto', createdAt: '2026-10-02T12:00:00Z' }

/** Small storage fixture exercising the same serialization boundary as browser localStorage. */
function storage(): Storage {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value) },
    removeItem: (key) => { rows.delete(key) },
    clear: () => rows.clear(),
    key: (index) => [...rows.keys()][index] ?? null,
    get length() { return rows.size }
  }
}

test('offline identity survives reopening but expires with the offline cache window', () => {
  const saved = storage()
  saveOfflineUser(saved, user, 100)
  assert.deepEqual(readOfflineUser(saved, 101), user)
  assert.equal(readOfflineUser(saved, OFFLINE_MAX_AGE + 101), null)
  assert.equal(readOfflineUser(saved, 99), null)
  saved.setItem(OFFLINE_SESSION_KEY, '{broken')
  assert.equal(readOfflineUser(saved, 101), null)
})

test('sign-out removes identity and persisted writes so reopening cannot recover the departed account', () => {
  const saved = storage()
  saveOfflineUser(saved, user, 100)
  saved.setItem(QUERY_CACHE_KEY, 'queued private writes')
  saveOfflineUser(saved, null)
  assert.equal(readOfflineUser(saved), null)
  assert.equal(saved.getItem(QUERY_CACHE_KEY), null)
})

test('a different account never hydrates another account data or queued writes', () => {
  const cache = { timestamp: 100, buster: 'test', clientState: { queries: [{ private: true }], mutations: [{ queued: true }] } }
  const raw = serializeAccountCache(JSON.stringify(cache), user.id)
  assert.deepEqual(deserializeAccountCache(raw, user.id).clientState, cache.clientState)
  for (const account of [null, 'another-owner']) {
    assert.deepEqual(deserializeAccountCache(raw, account).clientState, { queries: [], mutations: [] })
  }
  assert.deepEqual(deserializeAccountCache(JSON.stringify(cache), user.id).clientState, { queries: [], mutations: [] })
})

test('storage failure cannot stamp a new account cache with the previous identity', (context) => {
  const saved = storage()
  saveOfflineUser(saved, user, 100)
  context.mock.method(saved, 'setItem', () => { throw new Error('Quota exceeded') })
  assert.throws(() => saveOfflineUser(saved, { ...user, id: 'other' }, 101), /Quota exceeded/)
  assert.equal(readOfflineUser(saved, 102), null)
})
