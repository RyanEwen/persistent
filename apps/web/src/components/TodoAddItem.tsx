/**
 * The add row under a checklist on a card — the way to extend a list without
 * opening the editor.
 *
 * Collapsed to one quiet text button until it is used. The card it sits on already
 * has Done on it, and Done is the app's entire guarantee: nothing that merely adds
 * to a list may compete with it for attention (see apps/web/CLAUDE.md).
 *
 * Once open it *stays* open after each item, focus intact — a list is usually
 * extended by more than one line, and having to re-open the field between lines is
 * exactly the friction that sends people to the editor instead. An empty field
 * closes itself, so there is nothing to tidy up.
 *
 * What it adds is an item, and items belong to the reminder: the new line joins the
 * definition, so every later firing carries it, and it arrives unticked — which
 * means it also joins the body of whatever is nagging right now
 * (docs/notification-behavior.md §1a). It never touches a tick.
 */
import { useRef, useState } from 'react'
import Input from '@mui/joy/Input'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import AddIcon from '@mui/icons-material/Add'
import { MAX_TODO_ITEM_TEXT, type TodoItem } from '@persistent/shared'
import { newTodoItemId } from '../lib/todoItemId.js'

export function TodoAddItem({
  onAdd,
  disabled
}: {
  /** Called with a fully-formed item — the id is minted here, once, per item. */
  onAdd: (item: TodoItem) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement | null>(null)

  function commit() {
    const trimmed = text.trim()
    // An empty submit is the user saying they're done, not an item.
    if (!trimmed) {
      setOpen(false)
      return
    }
    onAdd({ id: newTodoItemId(), text: trimmed })
    setText('')
    // Tapping the add icon moves focus onto it, so put it back for the next line.
    input.current?.focus()
  }

  if (!open) {
    return (
      <Button
        variant="plain"
        color="neutral"
        size="sm"
        disabled={disabled}
        startDecorator={<AddIcon />}
        onClick={() => setOpen(true)}
        // A real tap target, like "Hide checked" beside it: this is used one-handed
        // and sometimes against a ringing alarm.
        sx={{ minHeight: 32, px: 1, fontSize: 'xs', fontWeight: 'md' }}
      >
        Add item
      </Button>
    )
  }

  return (
    <Input
      autoFocus
      size="sm"
      value={text}
      disabled={disabled}
      placeholder="New item"
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // No card is a <form>, but the native app's Back and the editor's submit
          // both live one level up — so own the key rather than letting it bubble.
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          setText('')
          setOpen(false)
        }
      }}
      // Only an *empty* field closes on blur. Tapping the add icon blurs the input
      // first, so closing on any blur would pull the button out from under the tap.
      onBlur={() => {
        if (!text.trim()) setOpen(false)
      }}
      slotProps={{
        input: {
          ref: input,
          'aria-label': 'New checklist item',
          // Stop at the stored limit rather than letting the server reject the line.
          maxLength: MAX_TODO_ITEM_TEXT,
          // The soft keyboard's action key adds the line instead of dismissing.
          enterKeyHint: 'done'
        }
      }}
      endDecorator={
        <IconButton
          size="sm"
          variant="plain"
          color="neutral"
          aria-label="Add item"
          disabled={disabled || text.trim() === ''}
          onClick={commit}
        >
          <AddIcon />
        </IconButton>
      }
      sx={{ flex: 1, minWidth: 0 }}
    />
  )
}
