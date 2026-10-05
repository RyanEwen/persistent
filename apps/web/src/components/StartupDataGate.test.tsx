import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../auth/useAuth.js'
import { saveOfflineUser } from '../auth/offlineSession.js'
import { initializeSessionNetwork } from '../auth/sessionNetwork.js'
import { queryClient, queryKeys } from '../lib/queryClient.js'
import { stopWs } from '../lib/wsClient.js'
import { StartupDataGate } from './StartupDataGate.js'
import { BackAwareModal } from './BackAwareModal.js'

const user = { id: 'owner', email: 'owner@example.com', displayName: null, timeZone: 'America/Toronto', createdAt: '2026-10-02T12:00:00Z' }

/** Controlled promise lets assertions happen while a real request remains in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** Mount the real auth/network/loading path against a restored personal reminder cache. */
async function mount(context: TestContext, online: boolean, fetchData: () => Promise<Array<{ id: string; title: string }>>, dialog = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const previous = new Map<string, PropertyDescriptor | undefined>()
  class Socket {
    close() {}
  }
  // The root tsx test runner uses classic JSX; production Vite uses automatic JSX.
  const globals = { React, WebSocket: Socket, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, IS_REACT_ACT_ENVIRONMENT: true }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  let connected = online
  Object.defineProperty(dom.window.navigator, 'onLine', { get: () => connected })
  initializeSessionNetwork()
  queryClient.clear()
  const defaults = queryClient.getDefaultOptions()
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, gcTime: Infinity } })
  saveOfflineUser(dom.window.localStorage, user)
  queryClient.setQueryData(queryKeys.reminders, [{ id: 'old', title: 'Stale reminder' }])
  queryClient.setQueryData(queryKeys.receivedShares, [{ id: 'revoked', title: 'Shared secret' }])
  const root = createRoot(dom.window.document.getElementById('root')!)
  context.after(async () => {
    await act(async () => root.unmount())
    stopWs()
    queryClient.clear()
    queryClient.setDefaultOptions(defaults)
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  })

  function Page() {
    const { data } = useQuery({ queryKey: queryKeys.reminders, queryFn: fetchData })
    return <div><input aria-label="Draft" defaultValue="Unsent draft" />{data?.map((reminder) => <span key={reminder.id}>{reminder.title}</span>)}
      {dialog && <BackAwareModal open onClose={() => {}}><div role="dialog"><input aria-label="Dialog draft" defaultValue="Unsent dialog draft" /></div></BackAwareModal>}
    </div>
  }
  function App() {
    const auth = useAuth()
    if (auth.loading) return <div>Checking session</div>
    if (!auth.user) return <div>Signed out</div>
    return <StartupDataGate key={auth.user.id}><Page /></StartupDataGate>
  }
  await act(async () => root.render(<QueryClientProvider client={queryClient}><AuthProvider><App /></AuthProvider></QueryClientProvider>))
  return {
    document: dom.window.document,
    connect: () => {
      connected = true
      dom.window.dispatchEvent(new dom.window.Event('online'))
    }
  }
}

/** Query observer notifications are intentionally batched onto a timer. */
async function settle() {
  for (let pass = 0; pass < 3; pass++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
}

test('startup hides restored reminders until fresh data replaces them', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ user })))
  const fresh = deferred<Array<{ id: string; title: string }>>()
  const app = await mount(context, true, () => fresh.promise)
  await settle()
  assert.ok(app.document.querySelector('[aria-label="Loading reminders"]'))
  const stale = [...app.document.querySelectorAll('span')].find((element) => element.textContent === 'Stale reminder')
  assert.ok(stale?.closest('[hidden]'), 'restored content is hidden from the screen and accessibility tree')
  fresh.resolve([{ id: 'fresh', title: 'Current reminder' }])
  await settle()
  assert.equal(app.document.querySelector('[aria-label="Loading reminders"]'), null)
  const current = [...app.document.querySelectorAll('span')].find((element) => element.textContent === 'Current reminder')
  assert.ok(current)
  assert.equal(current.closest('[hidden]'), null)
})

test('offline reopening shows personal cache and delays queued writes until session revalidation', async (context) => {
  const session = deferred<Response>()
  const fetch = context.mock.method(globalThis, 'fetch', () => session.promise)
  const app = await mount(context, false, async () => [{ id: 'fresh', title: 'Synced reminder' }])
  await settle()
  assert.match(app.document.body.textContent ?? '', /Offline\. Showing saved reminders/)
  assert.match(app.document.body.textContent ?? '', /Stale reminder/)
  assert.equal(queryClient.getQueryData(queryKeys.receivedShares), undefined)
  assert.equal(fetch.mock.callCount(), 0)
  let writes = 0
  const queued = queryClient.getMutationCache().build(queryClient, { gcTime: Infinity, mutationFn: async () => { writes++ } })
  const completed = queued.execute(undefined)
  await settle()
  assert.equal(queued.state.isPaused, true)
  await act(async () => app.connect())
  await settle()
  assert.equal(writes, 0, 'network detection alone does not replay the saved account writes')
  session.resolve(new Response(JSON.stringify({ user })))
  await completed
  await settle()
  assert.equal(writes, 1)
  assert.match(app.document.body.textContent ?? '', /Synced reminder/)
})

test('an expired server session clears offline identity, cached data, and queued mutations', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('{"user":null}'))
  const app = await mount(context, false, async () => [])
  await settle()
  const queued = queryClient.getMutationCache().build(queryClient, { gcTime: Infinity, mutationFn: async () => { throw new Error('must not replay') } })
  void queued.execute(undefined)
  await settle()
  await act(async () => app.connect())
  await settle()
  assert.match(app.document.body.textContent ?? '', /Signed out/)
  assert.equal(queryClient.getQueryData(queryKeys.reminders), undefined)
  assert.equal(queryClient.getMutationCache().getAll().length, 0)
  assert.equal(window.localStorage.getItem('persistent-offline-session'), null)
})

test('foregrounding hides old data while preserving the mounted draft', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ user })))
  const resumed = deferred<Array<{ id: string; title: string }>>()
  let opens = 0
  const app = await mount(context, true, async () => {
    if (++opens === 1) return [{ id: 'first', title: 'Before backgrounding' }]
    return resumed.promise
  })
  await settle()
  const draft = app.document.querySelector('input')!
  draft.value = 'Still editing'
  Object.defineProperty(app.document, 'visibilityState', { configurable: true, value: 'visible' })
  await act(async () => app.document.dispatchEvent(new window.Event('visibilitychange')))
  await settle()
  assert.ok(app.document.querySelector('[aria-label="Loading reminders"]'))
  assert.ok(draft.closest('[hidden]'))
  resumed.resolve([{ id: 'after', title: 'After foregrounding' }])
  await settle()
  assert.equal(app.document.querySelector('input'), draft)
  assert.equal(draft.value, 'Still editing')
  assert.equal(draft.closest('[hidden]'), null)
  assert.match(app.document.body.textContent ?? '', /After foregrounding/)
})

test('switching server accounts discards the previous account writes before opening the network', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ user: { ...user, id: 'other' } })))
  const app = await mount(context, false, async () => [{ id: 'other', title: 'Other account data' }])
  await settle()
  let writes = 0
  const queued = queryClient.getMutationCache().build(queryClient, { gcTime: Infinity, mutationFn: async () => { writes++ } })
  void queued.execute(undefined)
  await settle()
  await act(async () => app.connect())
  await settle()
  assert.equal(writes, 0)
  assert.equal(queryClient.getMutationCache().getAll().length, 0)
  assert.doesNotMatch(app.document.body.textContent ?? '', /Stale reminder/)
  assert.match(app.document.body.textContent ?? '', /Other account data/)
})

test('portalled dialogs wait with the page and retain their unsaved state', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ user })))
  const resumed = deferred<Array<{ id: string; title: string }>>()
  let opens = 0
  const app = await mount(context, true, async () => {
    if (++opens === 1) return [{ id: 'first', title: 'Before backgrounding' }]
    return resumed.promise
  }, true)
  await settle()
  const draft = app.document.querySelector<HTMLInputElement>('[aria-label="Dialog draft"]')!
  draft.value = 'Unfinished dialog edit'
  const modal = draft.closest('.MuiModal-root')!
  assert.notEqual(window.getComputedStyle(modal).visibility, 'hidden')
  Object.defineProperty(app.document, 'visibilityState', { configurable: true, value: 'visible' })
  await act(async () => app.document.dispatchEvent(new window.Event('visibilitychange')))
  await settle()
  assert.equal(window.getComputedStyle(modal).visibility, 'hidden')
  assert.notEqual(app.document.getElementById('root')?.getAttribute('aria-hidden'), 'true', 'the spinner remains accessible while the dialog waits')
  resumed.resolve([{ id: 'after', title: 'After foregrounding' }])
  await settle()
  assert.equal(app.document.querySelector('[aria-label="Dialog draft"]'), draft)
  assert.equal(draft.value, 'Unfinished dialog edit')
  assert.notEqual(window.getComputedStyle(modal).visibility, 'hidden')
})
