/** Notification URLs must use the list's reading action, while saved editor URLs keep working. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
// Keep router contexts on the same module export as the required component.
const { MemoryRouter, Route, Routes, useLocation } = require('react-router-dom') as typeof import('react-router-dom')
const { ReminderDialogLink } = require('./ReminderDialogLink.tsx') as typeof import('./ReminderDialogLink.js')
const { ReminderDialogContext } = require('./reminderDialogContext.ts') as typeof import('./reminderDialogContext.js')

/** Observe the real router destination after the deep link has been consumed. */
function Destination() {
  return <output>{useLocation().pathname}</output>
}

test('notification and saved editor links select the right dialog over Current', async (context) => {
  for (const row of [
    { path: '/reminders/first', action: ['view', 'first'] },
    { path: '/reminders/encoded%20id', action: ['view', 'encoded id'] },
    { path: '/reminders/first/edit', action: ['edit', 'first'] },
    { path: '/reminders/new', action: ['new'] }
  ]) {
    await context.test(row.path, async () => {
      const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
      const previous = new Map<string, PropertyDescriptor | undefined>()
      for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true })) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
        Object.defineProperty(globalThis, key, { configurable: true, value })
      }
      const actions: string[][] = []
      const root = createRoot(dom.window.document.getElementById('root')!)

      try {
        await act(async () => root.render(
          <MemoryRouter initialEntries={[row.path]}>
            <ReminderDialogContext.Provider value={{
              view: (id) => actions.push(['view', id]),
              edit: (id) => actions.push(['edit', id]),
              create: () => actions.push(['new'])
            }}>
              <Routes>
                <Route path="/" element={<Destination />} />
                <Route path="/reminders/new" element={<ReminderDialogLink kind="new" />} />
                <Route path="/reminders/:id" element={<ReminderDialogLink kind="view" />} />
                <Route path="/reminders/:id/edit" element={<ReminderDialogLink kind="edit" />} />
              </Routes>
            </ReminderDialogContext.Provider>
          </MemoryRouter>
        ))

        assert.deepEqual(actions, [row.action])
        assert.equal(dom.window.document.querySelector('output')?.textContent, '/')
      } finally {
        await act(async () => root.unmount())
        dom.window.close()
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor)
          else Reflect.deleteProperty(globalThis, key)
        }
      }
    })
  }
})
