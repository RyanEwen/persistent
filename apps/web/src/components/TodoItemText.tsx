/**
 * One checklist item's text, on a card: read it, or click it to rewrite it.
 *
 * The row's three regions each do exactly one thing — the checkbox ticks, this edits,
 * the handle drags — so nothing is guessed from where a tap landed. That is a real
 * trade against what came before, where the whole row ticked: the tick target shrinks
 * to the checkbox, which is why the checkbox keeps a deliberately generous hit area
 * (see `TodoChecklist`). Ticking one-handed against a ringing alarm is still the thing
 * this list is for.
 *
 * Committing is the same shape as the add row: Enter or blur saves, Escape abandons,
 * and an empty or unchanged value saves nothing rather than writing a blank line. The
 * text belongs to the *reminder*, so a rename here is the definition changing — every
 * later firing says the new thing, and the notification body with it.
 */
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/joy/Box'
import Input from '@mui/joy/Input'
import Typography from '@mui/joy/Typography'
import { MAX_TODO_ITEM_TEXT } from '@persistent/shared'

export function TodoItemText({
  text,
  struck,
  onRename,
  disabled
}: {
  text: string
  /** Ticked: struck through and dimmed, but still legible — the list is the record. */
  struck: boolean
  /**
   * Save new text for this item. Omitted where nothing owns the write (History, or a
   * surface with no reminder to edit), and the text is then plain and inert.
   */
  onRename?: (text: string) => void
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const input = useRef<HTMLInputElement | null>(null)

  // A rename landing from another device while this row is open would otherwise be
  // overwritten by whatever is half-typed here; closed, the row just follows the store.
  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  function commit() {
    const trimmed = draft.trim()
    setEditing(false)
    // An emptied line is a deletion the user has not asked for, so it reverts instead.
    if (!trimmed || trimmed === text) {
      setDraft(text)
      return
    }
    onRename?.(trimmed)
  }

  if (!onRename || disabled) {
    return (
      <Typography
        level="body-sm"
        sx={{ flex: 1, minWidth: 0, textDecoration: struck ? 'line-through' : undefined, color: struck ? 'text.tertiary' : undefined }}
      >
        {text}
      </Typography>
    )
  }

  if (!editing) {
    return (
      <Box
        role="button"
        tabIndex={0}
        aria-label={`Edit ${text}`}
        onClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setEditing(true)
          }
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          // Full-height so the whole line, not just the glyphs, opens the editor —
          // the row is a tap target on a phone even though it is text.
          alignSelf: 'stretch',
          display: 'flex',
          alignItems: 'center',
          px: 0.5,
          borderRadius: 'sm',
          cursor: 'text',
          '&:hover': { bgcolor: 'background.level1' }
        }}
      >
        <Typography
          level="body-sm"
          sx={{ textDecoration: struck ? 'line-through' : undefined, color: struck ? 'text.tertiary' : undefined }}
        >
          {text}
        </Typography>
      </Box>
    )
  }

  return (
    <Input
      autoFocus
      size="sm"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          setDraft(text)
          setEditing(false)
        }
      }}
      onBlur={commit}
      slotProps={{
        input: { ref: input, 'aria-label': `Edit ${text}`, maxLength: MAX_TODO_ITEM_TEXT, enterKeyHint: 'done' }
      }}
      sx={{ flex: 1, minWidth: 0 }}
    />
  )
}
