/**
 * Mints the id a checklist item carries for the rest of its life.
 *
 * A checklist item's id keys the per-occurrence checked set, so it has to be
 * unique and — crucially — *stable* across edits: renaming or reordering an item
 * must not move a tick onto a different one. So ids are minted once, here, and
 * carried through every read and write untouched.
 *
 * It lives in `lib/` rather than with the editor's form state because the editor
 * is no longer the only place a new item is born: the add row on a card mints one
 * too (`components/TodoAddItem.tsx`), and there the id is also what makes the
 * write idempotent if it replays after an offline stretch.
 *
 * `crypto.randomUUID` needs a secure context; the fallback keeps both surfaces
 * working on a plain-http origin rather than minting colliding ids.
 */
export function newTodoItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
