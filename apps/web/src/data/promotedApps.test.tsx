import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JSDOM } from 'jsdom'
import manifest from '../../../desktop/external/promo/Assets/PromotedApps/apps.json'
import { usePromotedApps } from './promotedApps.js'

/** Exercise the real query and persistent fallback without a network server. */
async function mount(context: TestContext, saved: string | null, response: unknown) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://persistent.example' })
  const previous = new Map<string, PropertyDescriptor | undefined>()
  const requests: RequestInit[] = []
  const globals = {
    React, window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (_url: unknown, options: RequestInit) => {
      requests.push(options)
      return new Response(JSON.stringify(response), { status: 200 })
    }
  }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  if (saved) dom.window.localStorage.setItem('persistent-promoted-apps-v1', saved)
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  const root = createRoot(dom.window.document.getElementById('root')!)
  function Page() {
    const catalog = usePromotedApps()
    return <div>{catalog.data.map((app) => app.name).join(',')}</div>
  }
  context.after(async () => {
    await act(async () => root.unmount())
    client.clear()
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  })
  await act(async () => root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  return { dom, requests, client }
}

test('a malformed refresh preserves last-good public content', async (context) => {
  const cached = structuredClone(manifest)
  cached.apps[0]!.name = 'Cached app'
  const saved = JSON.stringify(cached)
  const { dom, requests, client } = await mount(context, saved, { apps: [{ name: 'Broken' }] })
  assert.ok(dom.window.document.body.textContent?.includes('Cached app'))
  assert.equal(dom.window.localStorage.getItem('persistent-promoted-apps-v1'), saved)
  assert.equal(client.getQueryState(['promoted-apps'])?.status, 'error')
  assert.equal(requests[0]?.credentials, 'omit')
})

test('a corrupt local cache falls back to bundled content when the refresh is invalid', async (context) => {
  const { dom } = await mount(context, 'not JSON', null)
  assert.ok(dom.window.document.body.textContent?.includes('Repilot'))
  assert.ok(dom.window.document.body.textContent?.includes('PrintStream'))
})

test('a valid refresh replaces and saves the catalog, including an intentionally empty list', async (context) => {
  const { dom, client } = await mount(context, null, { apps: [] })
  assert.deepEqual(client.getQueryData(['promoted-apps']), [])
  assert.equal(dom.window.localStorage.getItem('persistent-promoted-apps-v1'), '{"apps":[]}')
})
