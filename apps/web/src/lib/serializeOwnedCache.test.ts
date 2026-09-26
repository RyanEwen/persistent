import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { serializeOwnedCache } from './serializeOwnedCache.js'

/** Exercise the serialized cache, since this is what survives an offline reload. */
function persistedClient(reminders: unknown, active: unknown, history: unknown): PersistedClient {
  return {
    timestamp: 1,
    buster: 'test',
    clientState: {
      mutations: [],
      queries: [
        { queryKey: ['reminders'], state: { data: reminders } },
        { queryKey: ['occurrences', 'active'], state: { data: active } },
        { queryKey: ['occurrences', 'upcoming'], state: { data: active } },
        { queryKey: ['occurrences', 'history'], state: { data: history } }
      ]
    }
  } as unknown as PersistedClient
}

test('offline cache keeps owned firings and removes received firings from every feed', () => {
  const active = [
    { id: 'owned-fire', reminderId: 'owned', reminder: { title: 'Private' } },
    { id: 'received-fire', reminderId: 'received', reminder: { title: 'Shared' } }
  ]
  const history = {
    pages: [{ occurrences: active, nextCursor: 'cursor' }],
    pageParams: ['']
  }
  const client = persistedClient([{ id: 'owned' }], active, history)

  const saved = JSON.parse(serializeOwnedCache(client)) as typeof client
  assert.deepEqual(
    (saved.clientState.queries[1]?.state.data as typeof active).map((row) => row.id),
    ['owned-fire']
  )
  assert.deepEqual(
    (saved.clientState.queries[2]?.state.data as typeof active).map((row) => row.id),
    ['owned-fire']
  )
  assert.deepEqual(
    ((saved.clientState.queries[3]?.state.data as typeof history).pages[0]?.occurrences ?? []).map((row) => row.id),
    ['owned-fire']
  )
  assert.deepEqual((saved.clientState.queries[3]?.state.data as typeof history).pageParams, [''])
  assert.equal((saved.clientState.queries[3]?.state.data as typeof history).pages[0]?.nextCursor, 'cursor')
  assert.doesNotMatch(JSON.stringify(saved), /Shared|received-fire/)
  assert.equal(active.length, 2, 'the live query cache remains intact')
})

test('occurrences are not saved when the owned reminder list is unavailable', () => {
  const client = persistedClient(undefined, [{ reminderId: 'received', id: 'fire' }], {
    pages: [{ occurrences: [{ reminderId: 'received', id: 'fire' }], nextCursor: null }],
    pageParams: ['']
  })

  const saved = JSON.parse(serializeOwnedCache(client)) as typeof client
  assert.deepEqual(saved.clientState.queries[1]?.state.data, [])
  assert.deepEqual(saved.clientState.queries[2]?.state.data, [])
  assert.deepEqual((saved.clientState.queries[3]?.state.data as { pages: Array<{ occurrences: unknown[] }> }).pages[0]?.occurrences, [])
})
