/**
 * The checklist rows on a TODO reminder — the items one firing covers.
 *
 * Each row keeps the stable id minted in `formState.ts`. Editing a row's text, and
 * reordering rows, both leave ids alone, so a firing already part-way through the
 * checklist keeps its ticks against the right items. Removing a row drops its id,
 * and any tick against it falls away with it (`todoProgress` filters).
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
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import FormHelperText from '@mui/joy/FormHelperText'
import Input from '@mui/joy/Input'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { emptyTodo, type TodoRow } from './formState.js'
import { REORDER_ROW_ATTR, useDragReorder } from './useDragReorder.js'

export function TodoItemsField({
  todos,
  onChange,
  onInsert,
  onMove,
  onRemove
}: {
  todos: TodoRow[]
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
  const { draggingIndex, handleProps } = useDragReorder(listRef, todos.length, onMove)

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

  return (
    <FormControl>
      <FormLabel>Checklist</FormLabel>
      <Stack spacing={1} ref={listRef}>
        {todos.map((item, index) => (
          <Stack
            key={item.id}
            direction="row"
            spacing={0.5}
            alignItems="center"
            {...{ [REORDER_ROW_ATTR]: '' }}
            // The row being dragged lifts off the list so it's obvious which one
            // is moving as the others shuffle around it.
            sx={{
              borderRadius: 'sm',
              ...(draggingIndex === index
                ? { bgcolor: 'background.level1', boxShadow: 'sm', position: 'relative', zIndex: 1 }
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
            <Input
              sx={{ flex: 1, minWidth: 0 }}
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
        <Button
          variant="outlined"
          size="sm"
          startDecorator={<AddIcon />}
          onClick={() => insertAt(todos.length)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Add item
        </Button>
      </Stack>
      <FormHelperText>
        Tick these off as you go. The reminder keeps nagging until you tap Done — ticking everything doesn't confirm
        it for you.
      </FormHelperText>
    </FormControl>
  )
}
