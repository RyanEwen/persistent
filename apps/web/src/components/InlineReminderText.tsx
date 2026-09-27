/** Text in the reading dialog that becomes a small editor only when selected. */
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/joy/Box'
import Input from '@mui/joy/Input'
import Textarea from '@mui/joy/Textarea'
import Typography from '@mui/joy/Typography'

export function InlineReminderText({
  text,
  kind,
  onSave
}: {
  text: string
  kind: 'title' | 'body'
  onSave: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const finished = useRef(false)
  const label = kind === 'title' ? 'Edit reminder title' : 'Edit note body'

  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  function commit() {
    if (finished.current) return
    finished.current = true
    const next = draft.trim()
    setEditing(false)
    if (kind === 'title' && !next) {
      setDraft(text)
      return
    }
    if (next !== text) onSave(next)
  }

  function cancel() {
    finished.current = true
    setDraft(text)
    setEditing(false)
  }

  function beginEditing() {
    finished.current = false
    setEditing(true)
  }

  if (editing) {
    return kind === 'title' ? (
      <Input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            cancel()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        slotProps={{ input: { 'aria-label': label, maxLength: 200 } }}
        sx={{ flex: 1, minWidth: 0, fontSize: 'lg' }}
      />
    ) : (
      <Textarea
        autoFocus
        minRows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            cancel()
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            commit()
          }
        }}
        slotProps={{ textarea: { 'aria-label': label, maxLength: 2000 } }}
        sx={{ width: '100%' }}
      />
    )
  }

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={beginEditing}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          beginEditing()
        }
      }}
      sx={{
        flex: kind === 'title' ? 1 : undefined,
        minWidth: 0,
        borderRadius: 'sm',
        cursor: 'text',
        '&:hover, &:focus-visible': { bgcolor: 'background.level1', outline: 'none' }
      }}
    >
      <Typography
        level={kind === 'title' ? 'title-lg' : 'body-sm'}
        sx={{ whiteSpace: 'pre-wrap', color: kind === 'body' && !text ? 'text.tertiary' : undefined }}
      >
        {text || 'Add note'}
      </Typography>
    </Box>
  )
}
