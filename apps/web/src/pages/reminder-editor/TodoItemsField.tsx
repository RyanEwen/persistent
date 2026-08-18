/**
 * The checklist rows on a TODO reminder — the items one firing covers.
 *
 * Each row keeps the stable id minted in `formState.ts`. Editing a row's text, and
 * reordering rows, both leave ids alone, so a firing already part-way through the
 * checklist keeps its ticks against the right items. Removing a row drops its id,
 * and any tick against it falls away with it (`todoProgress` filters).
 *
 * **The rows behave like the ones on a card**: the checkbox ticks, the text edits, the
 * handle drags. It used to be a read-only indicator instead, on the reasoning that a
 * control here would edit a different object from the rest of the form — which is still
 * true, and is now stated rather than avoided. A tick applies **immediately** and is not
 * part of the draft, because it belongs to the firing (or, on a note, to the reminder),
 * and there is exactly one home for it either way — the same one the card writes.
 * Cancelling the form does not put it back.
 *
 * That is also why the column only appears when there is something to tick: a new
 * reminder, or one merely scheduled, has no firing for a tick to belong to
 * (docs/notification-behavior.md §1a), so no checkbox is offered rather than one that
 * quietly does nothing.
 *
 * **Not a Joy `FormControl`**, unlike every other field on this form. That component is
 * built around a single control: it mints one id and hands it, with its
 * `aria-describedby` and `required`, to every input inside it — so N rows meant N inputs
 * sharing one id, a label pointing at whichever won, and a console error per extra row.
 * A checklist is a *set* of fields, so it is a labelled `role="group"` and each row
 * carries its own accessible name.
 *
 * Typing a list should never require the mouse: Enter inserts a row *below the
 * current one* (not just at the end) and moves focus into it, so a list can be
 * typed straight through. Rows are reordered by dragging the handle (see
 * `useDragReorder`), which also takes Up/Down when focused so the list stays
 * reorderable by keyboard.
 */
import { useEffect, useRef, useState } from 'react'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Checkbox from '@mui/joy/Checkbox'
import IconButton from '@mui/joy/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { emptyTodo, type TodoRow } from './formState.js'
import { TodoAddItem } from '../../components/TodoAddItem.js'
import { REORDER_ROW_ATTR, useDragReorder } from '../../lib/useDragReorder.js'

export function TodoItemsField({
  todos,
  checkedItemIds,
  onToggle,
  onChange,
  onInsert,
  onMove,
  onRemove
}: {
  todos: TodoRow[]
  /**
   * What one live firing has ticked, for display only. Absent when the reminder has
   * no firing waiting — a new reminder, or one that is merely scheduled, has no
   * ticks to show, because there is no occurrence for them to belong to. Empty (but
   * present) means a firing that has ticked nothing yet, which still gets the
   * indicator column.
   */
  checkedItemIds?: readonly string[]
  /**
   * Tick or untick one item on the firing those ticks belong to. Omitted when there is
   * nothing to tick (a new reminder, or one merely scheduled), which is what decides
   * whether the checkbox column appears at all.
   */
  onToggle?: (itemId: string, checked: boolean) => void
  onChange: (index: number, text: string) => void
  /** Insert `row` at `index`, shifting the rest down. */
  onInsert: (index: number, row: TodoRow) => void
  /** Move the row at `from` to position `to`. */
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
}) {
  // Keyed by item id, not index: reordering moves rows around, and an
  // index-keyed ref would focus whichever row happens to sit there afterwards.
  const inputs = useRef(new Map<string, HTMLInputElement | null>())
  const [focusId, setFocusId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const { draggingIndex, dragOffset, handleProps } = useDragReorder(listRef, todos.length, onMove)

  // Ref callbacks run before effects, so by the time this fires the freshly
  // inserted input has registered itself and can be focused.
  useEffect(() => {
    if (!focusId) return
    inputs.current.get(focusId)?.focus()
    setFocusId(null)
  }, [focusId])

  function insertAt(index: number) {
    const row = emptyTodo()
    onInsert(index, row)
    setFocusId(row.id)
  }

  const multiple = todos.length > 1
  const checkedIds = checkedItemIds ? new Set(checkedItemIds) : null
  // Names the group rather than any one row (see the note above).
  const labelId = 'checklist-field-label'

  return (
    <Box role="group" aria-labelledby={labelId}>
      <FormLabel id={labelId} sx={{ mb: 0.75 }}>
        Checklist
      </FormLabel>
      <Stack spacing={1} ref={listRef}>
        {todos.map((item, index) => (
          <Stack
            key={item.id}
            direction="row"
            spacing={0.5}
            alignItems="center"
            {...{ [REORDER_ROW_ATTR]: '' }}
            // The row being dragged lifts off the list and follows the pointer, so it
            // reads as carried rather than jumping a slot at a time; the others shuffle
            // underneath it.
            sx={{
              borderRadius: 'sm',
              ...(draggingIndex === index
                ? {
                    bgcolor: 'background.level1',
                    boxShadow: 'sm',
                    position: 'relative',
                    zIndex: 1,
                    transform: `translateY(${dragOffset}px)`
                  }
                : {})
            }}
          >
            {multiple && (
              <Box
                {...handleProps(index)}
                tabIndex={0}
                role="button"
                aria-label={`Reorder ${item.text || `item ${index + 1}`}. Use the up and down arrow keys to move it.`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  color: 'text.tertiary',
                  borderRadius: 'sm',
                  py: 0.5,
                  '&:active': { cursor: 'grabbing' },
                  '&:hover': { color: 'text.secondary' }
                }}
              >
                <DragIndicatorIcon fontSize="small" />
              </Box>
            )}
            {checkedIds && onToggle && (
              // A real checkbox, writing the firing this row's ticks belong to — the
              // same object, and the same endpoint, the card's checkbox writes. It
              // applies at once rather than on Save; see the note at the top of this
              // file for why that is the honest behaviour rather than a wart.
              <Checkbox
                size="md"
                checked={checkedIds.has(item.id)}
                onChange={(event) => onToggle(item.id, event.target.checked)}
                aria-label={item.text || `Item ${index + 1}`}
                sx={{ p: 0.5, flexShrink: 0, borderRadius: 'sm', '&:hover': { bgcolor: 'background.level1' } }}
              />
            )}
            <Input
              sx={{ flex: 1, minWidth: 0 }}
              // Its own name: the group's label names the set, not the row, and a
              // placeholder is not an accessible name (it vanishes once typing starts).
              aria-label={`Checklist item ${index + 1}`}
              placeholder={index === 0 ? 'First thing to do' : 'Next item'}
              value={item.text}
              slotProps={{
                input: {
                  ref: (el: HTMLInputElement | null) => {
                    if (el) inputs.current.set(item.id, el)
                    else inputs.current.delete(item.id)
                  }
                }
              }}
              onChange={(e) => onChange(index, e.target.value)}
              onKeyDown={(e) => {
                // The form's only other Enter target is submit, so intercept it:
                // typing a list should build the list, not save half of one.
                if (e.key !== 'Enter') return
                e.preventDefault()
                insertAt(index + 1)
              }}
            />
            {multiple && (
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                aria-label={`Remove ${item.text || `item ${index + 1}`}`}
                onClick={() => onRemove(index)}
              >
                <CloseIcon />
              </IconButton>
            )}
          </Stack>
        ))}
        {/* The same control the cards use, so adding a line is the same gesture in both
            places: type it, press Enter, keep typing. It replaces a button that
            appended an *empty* row for you to find and fill, which is a different
            interaction for the same intent. Enter inside a row still inserts one below,
            since that is how a list gets typed straight through. */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <TodoAddItem onAdd={(item) => onInsert(todos.length, item)} />
        </Box>
      </Stack>
    </Box>
  )
}
