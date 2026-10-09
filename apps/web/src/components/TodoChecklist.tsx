/**
 * The interactive checklist on one firing of a TODO reminder: a row per item, an
 * "n of m done" progress line, a control to hide the ticked ones, and — where the
 * caller has somewhere to put it — a row for adding an item.
 *
 * A row has a leading handle, checkbox, editable text, and trailing delete button.
 * The whole row used to tick, which was the better tap target but left nowhere
 * to put editing; the checkbox keeps a deliberately
 * generous hit area to pay some of that back, because ticking is what happens
 * one-handed against a ringing alarm. The same controls appear in the editor's
 * checklist field, so the list behaves the same in both places.
 *
 * Ticking and adding write different objects, which is the one thing to keep
 * straight here: a tick belongs to the firing, an item belongs to the reminder. So
 * ticking the same list on two cards ticks one firing each, while adding to it adds
 * to the definition and every card showing that checklist gains the row.
 *
 * The ticked set belongs to the *occurrence*, not the reminder, so a repeating
 * checklist starts each firing blank. Ticking every item deliberately does NOT
 * confirm the firing — only Done clears a nag (docs/notification-behavior.md §1a) —
 * so a fully-ticked list says so and points at Done rather than quietly
 * acknowledging on the user's behalf.
 *
 * Whether the ticked ones are hidden is the other way round: it belongs to the
 * *reminder* and is stored, so the state of a list survives a reload and follows
 * the user to their other devices. This component owns none of it — both the
 * ticks and the collapse are controlled by the caller.
 *
 * **Reordering** is the third kind of write again, and the same kind as adding: the
 * order is part of the definition, so a drag here changes the list every firing shows
 * and the order the notification lists it in. It is the one interaction that owns local
 * state — the rows follow the finger immediately, and the new order is *sent* once, when
 * the drag settles. Writing on every row crossed would put a request, and a push to
 * every device, on each step of a single gesture.
 */
import { useRef, useState } from 'react'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import Checkbox from '@mui/joy/Checkbox'
import { checklistCheckboxSx } from './checklistCheckboxSx.js'
import Typography from '@mui/joy/Typography'
import LinearProgress from '@mui/joy/LinearProgress'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import CloseIcon from '@mui/icons-material/Close'
import { MAX_TODO_ITEMS, todoProgress, type TodoItem } from '@persistent/shared'
import { REORDER_ROW_ATTR, useDragReorder } from '../lib/useDragReorder.js'
import { moveTodoItem } from '../lib/todoOrder.js'
import { TodoAddItem } from './TodoAddItem.js'
import { TodoItemText } from './TodoItemText.js'

/**
 * Minimum tap-target height per row. Ticking happens one-handed and sometimes
 * against a ringing alarm, so a row is deliberately taller than its text — but
 * only modestly: a checklist is a list to read down, and oversized rows push a
 * five-item list off the card. The width does the rest of the work (the label
 * stretches, so the whole line is the target).
 */
const ROW_MIN_HEIGHT = 36

export function TodoChecklist({
  items,
  checkedItemIds,
  onToggle,
  onAddItem,
  onRenameItem,
  onRemoveItem,
  onReorder,
  hideChecked = false,
  onHideCheckedChange,
  disabled,
  confirmable = true
}: {
  items: TodoItem[]
  checkedItemIds: readonly string[]
  onToggle?: (itemId: string, checked: boolean) => void
  /**
   * Append an item to the list, without going to the editor. Unlike a tick this
   * writes the *reminder* — items belong to the definition — so a caller wires it
   * to the reminder rather than to the firing on screen. Omitted where nothing
   * owns that write; the add row is then not offered.
   */
  onAddItem?: (item: TodoItem) => void
  /**
   * Save new text for one item. Like adding and reordering this writes the *reminder*,
   * so the new wording is what every later firing shows. Omitted where nothing owns
   * the write; the text is then plain and inert.
   */
  onRenameItem?: (itemId: string, text: string) => void
  /** Delete an item from the reminder definition. */
  onRemoveItem?: (itemId: string) => void
  /**
   * Store a new order for the list, as the full set of ids in the order they should
   * be in. Like adding, this writes the *reminder*. Omitted where nothing owns that
   * write; the drag handles are then not offered.
   */
  onReorder?: (itemIds: string[]) => void
  /**
   * Whether the ticked items are collapsed out of the list. Controlled by the
   * caller and stored on the reminder (`Reminder.hideCheckedItems`), so a list
   * left collapsed on one device is still collapsed on the next — this used to be
   * local `useState` and reset on every mount.
   *
   * Persisting it costs nothing at a fresh firing, which was the original
   * objection: ticks belong to the occurrence, so a new firing starts blank and a
   * remembered "hidden" hides nothing until the user ticks something themselves.
   */
  hideChecked?: boolean
  /** Omitted where nothing owns the state — the control is then not offered. */
  onHideCheckedChange?: (hidden: boolean) => void
  disabled?: boolean
  /**
   * Whether there is a Done to point at once everything is ticked. False on a
   * note, which has no firing and so nothing to confirm — telling someone to tap
   * a button that isn't there is worse than saying nothing.
   */
  confirmable?: boolean
}) {
  // The order being dragged, before it is sent. Null except mid-gesture: the stored
  // list is the truth, and holding a copy any longer would fight an edit arriving from
  // another device. Cleared on commit, when the optimistic cache update makes `items`
  // say the same thing.
  //
  // Mirrored in a ref so the next pointer move and commit can read the pending
  // order before React renders it, without reading inside a state updater.
  // Putting the send in the updater looks tidy and is wrong: React calls
  // updaters twice under StrictMode, so a single drag posted the order twice — and each
  // post is a write, a broadcast and a push to every device.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  /** Update gesture calculations immediately and queue the matching visual order. */
  function setOrder(ids: string[] | null) {
    dragOrderRef.current = ids
    setDragOrder(ids)
  }

  const ordered = dragOrder
    ? dragOrder.flatMap((id) => items.filter((item) => item.id === id))
    : items
  const checked = new Set(checkedItemIds)
  const { done, total } = todoProgress(items, checkedItemIds)
  const allDone = total > 0 && done === total
  // Ticking is the only way to hide an item, and unticking is the only way back —
  // so the control stays visible while anything is hidden, however few are left.
  const visible = hideChecked ? ordered.filter((item) => !checked.has(item.id)) : ordered
  // Nothing to reorder with one row, and nothing to drag when only one is on screen.
  const reorderable = Boolean(onReorder) && !disabled && visible.length > 1

  // `from`/`to` index the *visible* rows, which with ticked items hidden is a subset of
  // the list — so the move is applied to the whole list relative to the row landed on
  // (see `moveTodoItem`), leaving the hidden ones where they were.
  function moveVisible(from: number, to: number) {
    // Pointer moves can arrive before React renders the previous move. The drag
    // hook has already advanced its index, so resolve both indices against the
    // synchronous working order instead of that render's older visible rows.
    const currentIds = dragOrderRef.current
    const currentOrder = currentIds
      ? currentIds.flatMap((id) => items.filter((item) => item.id === id))
      : items
    const currentVisible = hideChecked ? currentOrder.filter((item) => !checked.has(item.id)) : currentOrder
    const moved = currentVisible[from]
    const target = currentVisible[to]
    if (!moved || !target) return
    setOrder(moveTodoItem(currentOrder, moved.id, target.id, to > from).map((item) => item.id))
  }

  const { draggingIndex, dragOffset, listProps, handleProps } = useDragReorder(listRef, visible.length, moveVisible, () => {
    // Sent once the gesture has settled, as the full set of ids: the server treats it
    // as a ranking, so an item added elsewhere meanwhile survives (see the endpoint).
    const settled = dragOrderRef.current
    if (!settled) return
    setOrder(null)
    onReorder?.(settled)
  })

  return (
    <Box>
      <Stack spacing={0.25} ref={listRef} {...listProps} sx={{ mb: visible.length > 0 ? 1 : 0 }}>
        {visible.map((item, index) => {
          const isChecked = checked.has(item.id)
          return (
            <Stack
              key={item.id}
              direction="row"
              alignItems="center"
              {...{ [REORDER_ROW_ATTR]: '' }}
              sx={{
                minHeight: ROW_MIN_HEIGHT,
                borderRadius: 'sm',
                '&:hover .todo-remove, &:focus-within .todo-remove, &:hover .todo-move, &:focus-within .todo-move': { opacity: 1 },
                '@media (hover: none)': { '& .todo-remove, & .todo-move': { opacity: 1 } },
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
              {reorderable && (
                <Box
                  className="todo-move"
                  {...handleProps(index)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Reorder ${item.text}. Use the up and down arrow keys to move it.`}
                  sx={{
                    opacity: 0,
                    transition: 'opacity 150ms ease',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    alignSelf: 'stretch',
                    px: 0.5,
                    color: 'text.tertiary',
                    borderRadius: 'sm',
                    '&:active': { cursor: 'grabbing' },
                    '&:hover': { color: 'text.secondary' }
                  }}
                >
                  <DragIndicatorIcon fontSize="small" />
                </Box>
              )}
              {/* The tick target is now the box alone rather than the whole line, so it
                  carries padding of its own to stay thumb-sized. It is labelled by the
                  item, since the text beside it is a separate control now. */}
              <Checkbox
                size="md"
                disabled={disabled || !onToggle}
                checked={isChecked}
                onChange={(event) => onToggle?.(item.id, event.target.checked)}
                aria-label={item.text}
                sx={{
                  ...checklistCheckboxSx,
                  p: 0.75,
                  borderRadius: 'sm',
                  '&:hover': { bgcolor: 'background.level1' }
                }}
              />
              {/* Struck through rather than removed: the list is the record of what
                  this firing covers, so a done item has to stay visible. */}
              <TodoItemText
                text={item.text}
                struck={isChecked}
                disabled={disabled}
                onRename={onRenameItem ? (text) => onRenameItem(item.id, text) : undefined}
              />
              {onRemoveItem && (
                <IconButton
                  className="todo-remove"
                  size="sm"
                  variant="plain"
                  color="danger"
                  disabled={disabled}
                  aria-label={`Remove ${item.text}`}
                  onClick={() => onRemoveItem(item.id)}
                  sx={{ opacity: 0, transition: 'opacity 150ms ease', flexShrink: 0 }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          )
        })}
      </Stack>
      {/* Under the rows and above the progress line: it extends the list, so it
          belongs to the list rather than to the "how far through it are you" row.
          A full list simply stops offering it — the cap is the stored limit, so
          there is nothing a card could do about it. */}
      {onAddItem && items.length < MAX_TODO_ITEMS && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <TodoAddItem onAdd={onAddItem} disabled={disabled} />
        </Box>
      )}
      {total > 0 && onToggle && <LinearProgress
        determinate
        value={total > 0 ? (done / total) * 100 : 0}
        color={allDone ? 'success' : 'warning'}
        sx={{ '--LinearProgress-thickness': '4px' }}
      />}
      {total > 0 && onToggle && <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mt: 0.5, minHeight: 32 }}
      >
        <Typography level="body-xs" color={allDone ? 'success' : undefined} sx={{ minWidth: 0 }}>
          {allDone
            ? confirmable
              ? `All ${total} checked — tap Done to confirm`
              : `All ${total} checked`
            : `${done} of ${total} done`}
        </Typography>
        {/* Only once something is ticked: before that it would toggle nothing.
            Right-anchored, opposite the count, so it reads as a control on that
            line rather than another item at the end of the list. */}
        {done > 0 && onHideCheckedChange && (
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            disabled={disabled}
            onClick={() => onHideCheckedChange(!hideChecked)}
            // A text button rather than a link: this sits under a thumb on a phone,
            // sometimes against a ringing alarm, so it keeps a real tap target.
            sx={{ flexShrink: 0, minHeight: 32, px: 1, fontSize: 'xs', fontWeight: 'md' }}
          >
            {hideChecked ? 'Show checked' : 'Hide checked'}
          </Button>
        )}
      </Stack>}
    </Box>
  )
}
