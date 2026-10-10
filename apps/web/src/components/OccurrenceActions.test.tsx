/** Completion must require a separate confirmation; cancellation never writes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { Occurrence } from '@persistent/shared'

const require = createRequire(import.meta.url)
const { OccurrenceActions } = require('./OccurrenceActions.tsx') as typeof import('./OccurrenceActions.js')

test('Done only arms confirmation, Not yet cancels, and Confirm done completes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const occurrence: Occurrence = {
    id: 'test-firing', reminderId: 'test-reminder', status: 'FIRED',
    scheduledFor: '2026-10-10T12:00:00Z', firedAt: '2026-10-10T12:00:00Z',
    lastNotifiedAt: '2026-10-10T12:00:00Z', acknowledgedAt: null,
    snoozedUntil: null, escalatedAt: null, supersededAt: null, checkedItemIds: [],
    reminder: {
      title: 'Test reminder', details: null, type: 'NONE', typeData: {},
      persistence: 'PERSISTENT', soundIntervalSeconds: null,
      shadeProminence: 'INHERIT', hideCheckedItems: false
    }
  }
  let completions = 0
  const root = createRoot(dom.window.document.getElementById('root')!)
  const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent.trim() === label)!

  try {
    await act(async () => root.render(
      <OccurrenceActions
        occurrence={occurrence}
        onDone={() => { completions += 1 }}
        doneLoading={false}
        onSnooze={() => {}}
        onSilence={() => {}}
        silenceLoading={false}
      />
    ))
    await act(async () => button('Done').click())
    assert.equal(completions, 0)
    assert.ok(button('Confirm done'))
    await act(async () => button('Not yet').click())
    assert.equal(completions, 0)
    assert.ok(button('Done'))
    await act(async () => button('Done').click())
    await act(async () => button('Confirm done').click())
    assert.equal(completions, 1)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
