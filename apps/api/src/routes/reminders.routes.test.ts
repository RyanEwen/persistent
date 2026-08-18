/**
 * Route *shape* checks for the reminders router.
 *
 * Express matches in registration order, so a literal sub-path registered after its
 * parametric sibling is dead: `POST /:id/items/:itemId` sitting above
 * `POST /:id/items/order` swallowed every reorder and answered it with "Invalid
 * checklist item.", because the reorder body has no `text` for the rename schema. A
 * drag looked like a validation bug, and nothing in either language's type system could
 * see it — the paths are strings, and both handlers are individually correct.
 *
 * These read the router's own layer stack rather than starting a server, so they cost
 * nothing and fail on the thing that actually broke: the order, and the fallthrough
 * that makes the order not matter.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remindersRouter } from './reminders.js'

interface Layer {
  route?: { path: string; methods: Record<string, boolean> }
}

/** Registered paths, in the order Express will try them. */
function postPaths(): string[] {
  return (remindersRouter.stack as Layer[])
    .filter((layer) => layer.route?.methods.post)
    .map((layer) => layer.route!.path)
}

test('the reorder route is registered before the parametric item route', () => {
  const paths = postPaths()
  const order = paths.indexOf('/:id/items/order')
  const rename = paths.indexOf('/:id/items/:itemId')
  assert.notEqual(order, -1, 'the reorder route should exist')
  assert.notEqual(rename, -1, 'the rename route should exist')
  assert.ok(
    order < rename,
    `POST /:id/items/order must be registered before /:id/items/:itemId, else every reorder is parsed as a rename (got ${paths.join(', ')})`
  )
})

test('every literal item sub-path is registered before the parametric one', () => {
  // The rule rather than the one instance: any future `/items/<word>` route added
  // below the parametric one would be just as invisible.
  const paths = postPaths()
  const rename = paths.indexOf('/:id/items/:itemId')
  const literalsAfter = paths
    .slice(rename + 1)
    .filter((path) => path.startsWith('/:id/items/') && !path.includes(':itemId'))
  assert.deepEqual(literalsAfter, [], 'these literal routes sit below /:id/items/:itemId and can never match')
})
