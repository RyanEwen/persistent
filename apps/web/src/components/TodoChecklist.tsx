/**
 * The interactive checklist on one firing of a TODO reminder: a checkbox per item
 * plus an "n of m done" progress line.
 *
 * The ticked set belongs to the *occurrence*, not the reminder, so a repeating
 * checklist starts each firing blank. Ticking every item deliberately does NOT
 * confirm the firing — only Done clears a nag (docs/notification-behavior.md §1a) —
 * so a fully-ticked list says so and points at Done rather than quietly
 * acknowledging on the user's behalf.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Checkbox from '@mui/joy/Checkbox'
import Typography from '@mui/joy/Typography'
import LinearProgress from '@mui/joy/LinearProgress'
import { todoProgress, type TodoItem } from '@persistent/shared'

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
  disabled
}: {
  items: TodoItem[]
  checkedItemIds: string[]
  onToggle: (itemId: string, checked: boolean) => void
  disabled?: boolean
}) {
  if (items.length === 0) return null
  const checked = new Set(checkedItemIds)
  const { done, total } = todoProgress(items, checkedItemIds)
  const allDone = done === total

  return (
    <Box>
      <Stack spacing={0.25} sx={{ mb: 1 }}>
        {items.map((item) => {
          const isChecked = checked.has(item.id)
          return (
            <Checkbox
              key={item.id}
              size="md"
              disabled={disabled}
              checked={isChecked}
              onChange={(event) => onToggle(item.id, event.target.checked)}
              // The whole row is the target, not just the box: Joy renders the
              // label inside the <label>, so stretching it full width means a tap
              // anywhere on the line ticks the item.
              sx={{
                minHeight: ROW_MIN_HEIGHT,
                alignItems: 'center',
                px: 0.5,
                borderRadius: 'sm',
                '& > *': { alignItems: 'center' },
                '&:hover': { bgcolor: 'background.level1' }
              }}
              slotProps={{ label: { sx: { flex: 1, minWidth: 0 } } }}
              label={
                // Struck through rather than removed: the list is the record of
                // what this firing covers, so a done item has to stay visible.
                <Typography
                  level="body-sm"
                  sx={{
                    textDecoration: isChecked ? 'line-through' : undefined,
                    color: isChecked ? 'text.tertiary' : undefined
                  }}
                >
                  {item.text}
                </Typography>
              }
            />
          )
        })}
      </Stack>
      <LinearProgress
        determinate
        value={total > 0 ? (done / total) * 100 : 0}
        color={allDone ? 'success' : 'warning'}
        sx={{ '--LinearProgress-thickness': '4px' }}
      />
      <Typography level="body-xs" sx={{ mt: 0.5 }} color={allDone ? 'success' : undefined}>
        {allDone ? `All ${total} checked — tap Done to confirm` : `${done} of ${total} done`}
      </Typography>
    </Box>
  )
}
