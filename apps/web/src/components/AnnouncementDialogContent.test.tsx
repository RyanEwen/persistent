/** Announcement visibility must not count as viewing until the user dismisses it. */
import { after, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { Announcement } from '@persistent/shared'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
const previous = new Map<string, PropertyDescriptor | undefined>()
const globals = {
  React, window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, DocumentFragment: dom.window.DocumentFragment,
  IS_REACT_ACT_ENVIRONMENT: true
}
for (const [name, value] of Object.entries(globals)) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value })
}

after(() => {
  dom.window.close()
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

const require = createRequire(import.meta.url)
const { AnnouncementDialogContent } = require('./AnnouncementDialogContent.tsx') as typeof import('./AnnouncementDialogContent.js')
const { StartupDataContext } = require('./startupDataContext.ts') as typeof import('./startupDataContext.js')
const { MemoryRouter } = require('react-router-dom') as typeof import('react-router-dom')
const { BackAwareModal } = require('./BackAwareModal.tsx') as typeof import('./BackAwareModal.js')

const announcement: Announcement = { id: 'themes-match-system', title: 'New themes', paragraphs: ['Navy is no longer the default.'] }

/** Render the real Joy dialog with controlled startup and server response state. */
async function mount(context: TestContext, path = '/') {
  const root = createRoot(dom.window.document.getElementById('root')!)
  const viewed: string[] = []
  let list: Announcement[] = [announcement]
  let ready = true
  let otherDialog = false
  const render = async (update: { ready?: boolean; list?: Announcement[]; otherDialog?: boolean } = {}) => {
    ready = update.ready ?? ready
    list = update.list ?? list
    otherDialog = update.otherDialog ?? otherDialog
    await act(async () => root.render(
      <MemoryRouter initialEntries={[path]}>
        <StartupDataContext.Provider value={ready}>
          <BackAwareModal open={otherDialog}><div>Existing dialog</div></BackAwareModal>
          <AnnouncementDialogContent announcements={list} loaded enabled onViewed={({ id }) => { viewed.push(id) }} />
        </StartupDataContext.Provider>
      </MemoryRouter>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  }
  context.after(async () => {
    await act(async () => root.unmount())
    await new Promise((resolve) => setTimeout(resolve, 30))
    dom.window.history.replaceState(null, '', '/')
  })
  const title = (text = 'New themes') => dom.window.document.body.textContent?.includes(text) ?? false
  const close = async () => {
    const button = [...dom.window.document.querySelectorAll('button')].find((item) => item.textContent === 'Got it')!
    await act(async () => button.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  }
  return { render, viewed, title, close }
}

test('appearance and foreground refresh do not record viewing; closing does exactly once', async (context) => {
  const app = await mount(context)
  await app.render({ ready: false })
  assert.equal(app.title(), false)
  assert.deepEqual(app.viewed, [])
  await app.render({ ready: true })
  assert.equal(app.title(), true)
  await app.render({ ready: false })
  await app.render({ ready: true })
  assert.deepEqual(app.viewed, [])
  await app.close()
  assert.deepEqual(app.viewed, ['themes-match-system'])
  await app.render()
  assert.equal(app.title(), false)
})

test('an existing dialog has priority, and a cross-device viewed response closes news without another write', async (context) => {
  const app = await mount(context)
  await app.render({ otherDialog: true })
  assert.equal(app.title(), false)
  await app.render({ otherDialog: false })
  assert.equal(app.title(), true)
  await app.render({ list: [] })
  assert.equal(app.title(), false)
  assert.deepEqual(app.viewed, [])
})

test('reminder deep links are not interrupted by announcements', async (context) => {
  const app = await mount(context, '/reminders/reminder-id')
  await app.render()
  assert.equal(app.title(), false)
  assert.deepEqual(app.viewed, [])
})


test('queued announcements wait for the previous history pop and are viewed individually', async (context) => {
  const app = await mount(context)
  const second = { ...announcement, id: 'another-update', title: 'Another update' }
  await app.render({ list: [announcement, second] })
  assert.equal(app.title(), true)
  await app.close()
  assert.equal(app.title('Another update'), true)
  assert.deepEqual(app.viewed, ['themes-match-system'])
  await app.close()
  assert.deepEqual(app.viewed, ['themes-match-system', 'another-update'])
  assert.equal(app.title('Another update'), false)
})
