import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createRequire } from 'node:module'
import { REORDER_ROW_ATTR, useDragReorder } from './useDragReorder.js'

/**
 * Mount the drag hook or the real checklist and route pointer events to capture.
 * grabbedIndex selects a visible row; hiddenItemIds exercises the collapsed view.
 */
async function mount(context: TestContext, {
  surface = 'hook',
  grabbedIndex = 0,
  hiddenItemIds = []
}: {
  surface?: 'hook' | 'checklist'
  grabbedIndex?: number
  hiddenItemIds?: string[]
} = {}) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({ React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  // Node's CJS loader unwraps Joy/icon defaults as Vite does in production.
  const require = createRequire(import.meta.url)
  const { TodoChecklist } = require('../components/TodoChecklist.tsx') as typeof import('../components/TodoChecklist.js')
  let captured: HTMLElement | null = null
  let capturedId: number | null = null
  const prototype = dom.window.HTMLElement.prototype
  prototype.setPointerCapture = function (id) {
    // The fake browser records the receiver, just as native pointer capture does.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    captured = this
    capturedId = id
  }
  prototype.hasPointerCapture = function (id) { return captured === this && capturedId === id }
  prototype.releasePointerCapture = function () { captured = null; capturedId = null }
  prototype.getBoundingClientRect = function () {
    const index = [...(this.parentElement?.children ?? [])].indexOf(this)
    return { top: index * 48, height: 48 } as DOMRect
  }
  const commits: string[][] = []
  function List({ revision }: { revision: number }) {
    const listRef = useRef<HTMLDivElement>(null)
    const [items, setItems] = useState(['a', 'b', 'c', 'd'])
    const { listProps, handleProps, draggingIndex, dragOffset } = useDragReorder(listRef, items.length, (from, to) => {
      const next = [...items]
      next.splice(to, 0, next.splice(from, 1)[0]!)
      setItems(next)
    }, () => commits.push(items))
    return <div ref={listRef} {...listProps} data-revision={revision} data-dragging={draggingIndex} data-offset={dragOffset}>
      {items.map((id, index) => <div key={id} {...{ [REORDER_ROW_ATTR]: '' }}><button {...handleProps(index)}>{id}</button></div>)}
    </div>
  }
  const { CacheProvider } = require('@emotion/react') as typeof import('@emotion/react')
  const createCache = require('@emotion/cache').default as typeof import('@emotion/cache').default
  const cache = createCache({ key: 'drag-test', container: dom.window.document.head })

  function ChecklistList({ revision }: { revision: number }) {
    return (
      <CacheProvider value={cache}>
        <div data-revision={revision}>
          <TodoChecklist
            items={['a', 'b', 'c', 'd'].map((id) => ({ id, text: id }))}
            checkedItemIds={hiddenItemIds}
            hideChecked={hiddenItemIds.length > 0}
            onReorder={(ids) => commits.push(ids)}
          />
        </div>
      </CacheProvider>
    )
  }
  const Surface = surface === 'hook' ? List : ChecklistList
  const root = createRoot(dom.window.document.getElementById('root')!)
  context.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  })
  await act(async () => root.render(<Surface revision={0} />))
  const rows = dom.window.document.querySelectorAll<HTMLElement>(`[${REORDER_ROW_ATTR}]`)
  const list = rows[0]!.parentElement!
  const handle = (rows[grabbedIndex]!.querySelector('[role="button"]') ?? rows[grabbedIndex]!.firstElementChild!) as HTMLElement

  /** Dispatch without flushing so a batch exercises events between React renders. */
  function dispatchPointer(type: string, y: number, pointerId = 1) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { pointerId, clientY: y, button: 0, isPrimary: pointerId === 1 })
    const target = captured ?? handle
    target.dispatchEvent(event)
  }
  return {
    list, handle, commits,
    order: () => [...list.querySelectorAll(`[${REORDER_ROW_ATTR}]`)].map((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]')
      return checkbox?.getAttribute('aria-label') ?? row.textContent
    }),
    captured: () => captured,
    rerender: async () => { await act(async () => root.render(<Surface revision={1} />)) },
    pointer: async (type: string, y: number, pointerId = 1) => {
      await act(async () => dispatchPointer(type, y, pointerId))
    },
    pointerBatch: async (positions: number[], release = false) => {
      await act(async () => {
        for (const y of positions) {
          dispatchPointer('pointermove', y)
        }
        if (release) {
          dispatchPointer('pointerup', positions.at(-1)!)
        }
      })
    },
    key: async (key: string) => {
      await act(async () => handle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })))
    }
  }
}

test('capture stays on the list while keyed rows reorder and the parent rerenders', async (context) => {
  const app = await mount(context)
  await app.pointer('pointerdown', 0)
  assert.equal(app.captured(), app.list, 'the moved handle must never own capture')
  await app.pointer('pointermove', 55)
  assert.deepEqual(app.order(), ['b', 'a', 'c', 'd'])
  assert.equal(app.list.dataset.offset, '7')
  await app.rerender()
  await app.pointer('pointermove', 105)
  assert.deepEqual(app.order(), ['b', 'c', 'a', 'd'])
  await app.pointer('pointermove', 155)
  assert.deepEqual(app.order(), ['b', 'c', 'd', 'a'])
  assert.equal(app.commits.length, 0)
  await app.pointer('pointerup', 155)
  assert.deepEqual(app.commits, [['b', 'c', 'd', 'a']])
  assert.equal(app.captured(), null)
  assert.equal(app.list.dataset.dragging, undefined)
  assert.equal(app.list.dataset.offset, '0')
  await app.pointer('lostpointercapture', 155)
  assert.equal(app.commits.length, 1)
})

for (const end of ['pointercancel', 'lostpointercapture']) {
  test(`${end} settles once and ignores unrelated pointers`, async (context) => {
    const app = await mount(context)
    await app.pointer('pointerdown', 0)
    await app.pointer('pointermove', 55)
    await app.pointer(end, 55, 2)
    assert.equal(app.commits.length, 0)
    await app.pointer(end, 55)
    await app.pointer('pointerup', 55)
    assert.deepEqual(app.commits, [['b', 'a', 'c', 'd']])
    await app.pointer('pointermove', 150)
    assert.deepEqual(app.order(), ['b', 'a', 'c', 'd'])
  })
}

test('a grab without movement does not commit; keyboard reordering still commits immediately', async (context) => {
  const app = await mount(context)
  await app.pointer('pointerdown', 0)
  await app.pointer('pointerup', 0)
  assert.equal(app.commits.length, 0)
  await app.key('ArrowDown')
  assert.deepEqual(app.order(), ['b', 'a', 'c', 'd'])
  assert.equal(app.commits.length, 1)
})

test('reading checklist keeps the same item through upward then downward moves before React renders', async (context) => {
  const app = await mount(context, { surface: 'checklist', grabbedIndex: 1 })
  await app.pointer('pointerdown', 48)
  await app.pointerBatch([-7, 48])
  assert.deepEqual(app.order(), ['a', 'b', 'c', 'd'])
  await app.pointer('pointermove', 105)
  assert.deepEqual(app.order(), ['a', 'c', 'b', 'd'])
  await app.pointer('pointerup', 105)
  assert.deepEqual(app.commits, [['a', 'c', 'b', 'd']])
})

test('reading checklist can reverse repeatedly across several rows between renders', async (context) => {
  const app = await mount(context, { surface: 'checklist', grabbedIndex: 3 })
  await app.pointer('pointerdown', 144)
  await app.pointerBatch([89, 41, -7, 48, 105, 155, 105, 48])
  assert.deepEqual(app.order(), ['a', 'd', 'b', 'c'])
  await app.rerender()
  await app.pointer('pointermove', 155)
  assert.deepEqual(app.order(), ['a', 'b', 'c', 'd'])
  await app.pointer('pointerup', 155)
  assert.deepEqual(app.commits, [['a', 'b', 'c', 'd']])
})

test('direction changes with checked rows hidden preserve the held item and hidden ids', async (context) => {
  const app = await mount(context, { surface: 'checklist', grabbedIndex: 1, hiddenItemIds: ['b'] })
  await app.pointer('pointerdown', 48)
  await app.pointerBatch([-7, 48, 105])
  assert.deepEqual(app.order(), ['a', 'd', 'c'])
  await app.pointer('pointerup', 105)
  assert.deepEqual(app.commits, [['a', 'b', 'd', 'c']])
})


test('releasing before React renders commits the final reversed order exactly once', async (context) => {
  const app = await mount(context, { surface: 'checklist', grabbedIndex: 1 })
  await app.pointer('pointerdown', 48)
  await app.pointerBatch([-7, 48, 105], true)
  assert.deepEqual(app.commits, [['a', 'c', 'b', 'd']])
  assert.equal(app.captured(), null)
  await app.pointer('lostpointercapture', 105)
  assert.equal(app.commits.length, 1)
})
