/** User-visible update decisions, independent of worker activation timing. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createWebUpdateChecker } from './webUpdate'

function fixture() {
  let local: string | null = 'current'
  let target: string | null = 'current'
  let reloads = 0
  let blockedStorage = false
  let offline = false
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }
  } as Storage
  const environment = {
    localBuildId: () => local,
    servedBuildId: async () => {
      if (offline) throw new Error('offline')
      return target
    },
    storage: () => {
      if (blockedStorage) throw new Error('blocked')
      return storage
    },
    reload: () => { reloads += 1 }
  }
  return {
    check: createWebUpdateChecker(environment),
    nextPage: () => createWebUpdateChecker(environment),
    setLocal: (value: string | null) => { local = value },
    setTarget: (value: string | null) => { target = value },
    blockStorage: () => { blockedStorage = true },
    goOffline: () => { offline = true },
    reloads: () => reloads
  }
}

test('current pages do not reload when a worker catches up, even repeatedly', async () => {
  const app = fixture()
  await app.check()
  await app.check()
  assert.equal(app.reloads(), 0)
})

test('stale pages reload once across simultaneous and repeated checks', async () => {
  const app = fixture()
  app.setTarget('new')
  await Promise.all([app.check(), app.check()])
  await app.check()
  assert.equal(app.reloads(), 1)
})

test('a failed update cannot loop, but landing permits the next release', async () => {
  const app = fixture()
  app.setTarget('new')
  await app.check()
  await app.nextPage()()
  assert.equal(app.reloads(), 1)
  app.setLocal('new')
  const landed = app.nextPage()
  await landed()
  app.setTarget('newer')
  await landed()
  assert.equal(app.reloads(), 2)
})

test('offline, unknown identities and blocked storage never force a refresh', async () => {
  for (const scenario of ['offline', 'local', 'target', 'storage']) {
    const app = fixture()
    app.setTarget('new')
    if (scenario === 'offline') app.goOffline()
    if (scenario === 'local') app.setLocal(null)
    if (scenario === 'target') app.setTarget(null)
    if (scenario === 'storage') app.blockStorage()
    await app.check()
    assert.equal(app.reloads(), 0, scenario)
  }
})
