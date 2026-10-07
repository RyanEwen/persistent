import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { REORDER_ROW_ATTR, useDragReorder } from './useDragReorder.js'

/** Render keyed rows and route pointer events to the element holding capture. */
async function mount(context: TestContext) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
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
  const root = createRoot(dom.window.document.getElementById('root')!)
  context.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  })
  await act(async () => root.render(<List revision={0} />))
  const list = dom.window.document.querySelector<HTMLElement>('[data-revision]')!
  const handle = list.querySelector('button')!
  return {
    list, handle, commits,
    order: () => [...list.querySelectorAll('button')].map((button) => button.textContent),
    captured: () => captured,
    rerender: async () => { await act(async () => root.render(<List revision={1} />)) },
    pointer: async (type: string, y: number, pointerId = 1) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { pointerId, clientY: y, button: 0, isPrimary: pointerId === 1 })
      await act(async () => (captured ?? handle).dispatchEvent(event))
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
