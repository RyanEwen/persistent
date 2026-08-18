import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveTodoItem } from './todoOrder.js'

const items = [
  { id: 'a', text: 'Milk' },
  { id: 'b', text: 'Bread' },
  { id: 'c', text: 'Eggs' },
  { id: 'd', text: 'Jam' }
]
const ids = (list: { id: string }[]) => list.map((i) => i.id)

test('dragging down lands below the row it crossed', () => {
  assert.deepEqual(ids(moveTodoItem(items, 'a', 'c', true)), ['b', 'c', 'a', 'd'])
})

test('dragging up lands above the row it crossed', () => {
  assert.deepEqual(ids(moveTodoItem(items, 'd', 'b', false)), ['a', 'd', 'b', 'c'])
})

test('a hidden row between the two keeps its place', () => {
  // The card may be drawing only the unticked rows; 'b' is hidden here, and moving 'a'
  // onto 'c' must not fling it to the end — this is why the move is expressed as
  // "relative to that item" rather than "from index 0 to index 1".
  assert.deepEqual(ids(moveTodoItem(items, 'a', 'c', true)), ['b', 'c', 'a', 'd'])
  assert.deepEqual(ids(moveTodoItem(items, 'c', 'a', false)), ['c', 'a', 'b', 'd'])
})

test('moving an item onto itself changes nothing', () => {
  assert.deepEqual(ids(moveTodoItem(items, 'b', 'b', true)), ['a', 'b', 'c', 'd'])
})

test('an unknown id leaves the list alone rather than scrambling it', () => {
  assert.deepEqual(ids(moveTodoItem(items, 'gone', 'b', true)), ['a', 'b', 'c', 'd'])
  assert.deepEqual(ids(moveTodoItem(items, 'a', 'gone', true)), ['a', 'b', 'c', 'd'])
})

test('the returned list is a copy — the caller can hold the original', () => {
  const next = moveTodoItem(items, 'a', 'b', true)
  assert.notEqual(next, items)
  assert.deepEqual(ids(items), ['a', 'b', 'c', 'd'])
})
