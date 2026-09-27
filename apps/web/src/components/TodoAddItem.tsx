/**
 * The add row under a checklist in the reading dialog or editor: extend a list without
 * opening the editor.
 *
 * The quiet add button stays visible when a draft row opens above it, so the new
 * item occupies the list rather than replacing the control that created it.
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
import Stack from '@mui/joy/Stack'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
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
    // Tapping the save icon moves focus onto it, so put it back for the next line.
    input.current?.focus()
  }

  return (
    <Stack spacing={0.5} sx={{ width: '100%' }}>
      {open && (
        <Input
          autoFocus
          size="sm"
          value={text}
          disabled={disabled}
          placeholder="New item"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setText('')
              setOpen(false)
            }
          }}
          onBlur={() => {
            if (!text.trim()) setOpen(false)
          }}
          slotProps={{
            input: {
              ref: input,
              'aria-label': 'New checklist item',
              maxLength: MAX_TODO_ITEM_TEXT,
              enterKeyHint: 'done'
            }
          }}
          endDecorator={
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              aria-label={text.trim() ? 'Save new item' : 'Cancel new item'}
              disabled={disabled}
              onClick={() => {
                if (text.trim()) commit()
                else setOpen(false)
              }}
            >
              {text.trim() ? <AddIcon /> : <CloseIcon />}
            </IconButton>
          }
          sx={{ flex: 1, minWidth: 0 }}
        />
      )}
      <Button
        variant="plain"
        color="neutral"
        size="sm"
        disabled={disabled}
        startDecorator={<AddIcon />}
        onClick={() => {
          if (open && text.trim()) commit()
          else {
            setOpen(true)
            input.current?.focus()
          }
        }}
        // A real tap target, like "Hide checked" beside it: this is used one-handed
        // and sometimes against a ringing alarm.
        sx={{ minHeight: 32, px: 1, fontSize: 'xs', fontWeight: 'md', alignSelf: 'flex-start' }}
      >
        Add item
      </Button>
    </Stack>
  )
}
