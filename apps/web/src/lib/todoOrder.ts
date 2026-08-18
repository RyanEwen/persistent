/**
 * Turning "the user dragged the row at position A to position B" into the checklist
 * order to store.
 *
 * The subtlety is that a card may be drawing only *part* of the list: with ticked items
 * hidden (`Reminder.hideCheckedItems`), the rows on screen are a subset, and the ones
 * that aren't drawn still have to keep their places. So the move is expressed in terms
 * of the two items involved — the one picked up and the one it landed on — and applied
 * to the full list, rather than as "index A becomes index B", which would only be true
 * of the visible slice and would fling the hidden items to the end.
 *
 * Pure, so the rule is testable without a browser, and used for both the optimistic
 * order the card draws mid-drag and the ranking it eventually sends.
 */
import type { TodoItem } from '@persistent/shared'

/**
 * `items` with `movedId` repositioned relative to `targetId`.
 *
 * `after` says which side of the target it lands on: dragging *downwards* drops below
 * the row you crossed, dragging up drops above it. Returns `items` untouched when
 * either id is unknown or they are the same, so a stray call can't scramble a list.
 */
export function moveTodoItem(
  items: readonly TodoItem[],
  movedId: string,
  targetId: string,
  after: boolean
): TodoItem[] {
  if (movedId === targetId) return [...items]
  const moved = items.find((item) => item.id === movedId)
  if (!moved || !items.some((item) => item.id === targetId)) return [...items]
  const rest = items.filter((item) => item.id !== movedId)
  const targetIndex = rest.findIndex((item) => item.id === targetId)
  rest.splice(after ? targetIndex + 1 : targetIndex, 0, moved)
  return rest
}
