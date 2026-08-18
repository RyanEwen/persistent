/**
 * Pointer-driven vertical reordering for a short list of uniform-height rows.
 *
 * Deliberately dependency-free: a drag library would be the obvious reach, but
 * this list is a handful of single-line rows in a fixed vertical stack, which is
 * the one case a few lines of pointer maths handles completely — and the web
 * bundle here is what the Android app ships, so a dependency is not free.
 *
 * The row order updates *live* as you drag (rather than dropping at the end), so
 * the list always shows what you'd get by letting go. The maths: measure the row
 * pitch once at grab time, convert the pointer's travel into whole-row steps, and
 * rebase the origin every time a step is applied so the drag stays anchored to the
 * row under the finger instead of drifting.
 *
 * The dragged row also *follows the pointer* rather than only snapping between slots:
 * `dragOffset` is the leftover travel since the last whole step (always within half a
 * row), which the caller applies as a `translateY`. Without it the row you are holding
 * sits still until it jumps a whole position, which reads as a stutter rather than as
 * dragging — the other rows move and the one under your finger does not.
 *
 * Pointer capture means move/up keep arriving at the handle even when the pointer
 * outruns it, and `touchAction: 'none'` stops a touch-drag from scrolling the page
 * instead. The handle is focusable and takes Up/Down as well — a drag handle that
 * only responds to a pointer is unusable by keyboard.
 *
 * Two callers with different costs per move, which is what `onCommit` is for. The
 * editor reorders form state, so every step is free and it needs nothing. A card
 * reorders the *stored* list, so a step that wrote would put a request (and a push to
 * every device) on each row the finger crosses — there, `onMove` updates a local
 * working order and `onCommit` writes it once, when the drag ends or a key move lands.
 *
 * It lives in `lib/` rather than beside the editor because the cards reorder the same
 * list from `components/TodoChecklist.tsx`, and a component reaching into a page's
 * folder is backwards.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

/** Marks a row so the hook can measure the distance between consecutive rows. */
export const REORDER_ROW_ATTR = 'data-reorder-row'

interface Drag {
  index: number
  originY: number
  pitch: number
}

export function useDragReorder(
  listRef: RefObject<HTMLElement | null>,
  count: number,
  onMove: (from: number, to: number) => void,
  /** Called once the order has settled — see the note above about write cost. */
  onCommit?: () => void
) {
  const drag = useRef<Drag | null>(null)
  // Whether the drag in progress has actually moved anything, so letting go without
  // moving doesn't write a "reorder" that reorders nothing.
  const moved = useRef(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  // Pixels the held row is offset from its slot — see the note above.
  const [dragOffset, setDragOffset] = useState(0)

  function endDrag() {
    drag.current = null
    setDraggingIndex(null)
    setDragOffset(0)
    if (moved.current) {
      moved.current = false
      onCommit?.()
    }
  }

  /** Centre-to-centre distance between rows (row height + the stack's gap). */
  function rowPitch(): number {
    const rows = listRef.current?.querySelectorAll(`[${REORDER_ROW_ATTR}]`)
    if (!rows || rows.length === 0) return 48
    if (rows.length === 1) return rows[0]!.getBoundingClientRect().height
    return rows[1]!.getBoundingClientRect().top - rows[0]!.getBoundingClientRect().top
  }

  function step(to: number) {
    const current = drag.current
    if (!current) return
    const target = Math.min(count - 1, Math.max(0, to))
    if (target === current.index) return
    onMove(current.index, target)
    moved.current = true
    // Rebase: the row now sits `target` rows down, so subsequent travel is
    // measured from there. Without this the next move re-applies the same offset.
    current.originY += (target - current.index) * current.pitch
    current.index = target
    setDraggingIndex(target)
  }

  return {
    draggingIndex,
    dragOffset,
    handleProps: (index: number) => ({
      style: { touchAction: 'none' as const, cursor: 'grab' },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        // Stops the browser starting a text selection / native image drag.
        event.preventDefault()
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Capture is an optimization, not a requirement — carry on without it.
        }
        drag.current = { index, originY: event.clientY, pitch: rowPitch() }
        moved.current = false
        setDraggingIndex(index)
        setDragOffset(0)
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = drag.current
        if (!current) return
        const steps = Math.round((event.clientY - current.originY) / current.pitch)
        if (steps !== 0) step(current.index + steps)
        // After any step, `originY` has been rebased onto the new slot, so what's left
        // is how far past that slot the finger is — the row's own offset.
        setDragOffset(event.clientY - current.originY)
      },
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
        if (delta === 0) return
        event.preventDefault()
        const target = Math.min(count - 1, Math.max(0, index + delta))
        if (target === index) return
        // A key move is its own complete gesture, so it commits on the spot. No offset
        // to animate: the row is placed, not carried.
        onMove(index, target)
        onCommit?.()
      }
    })
  }
}
