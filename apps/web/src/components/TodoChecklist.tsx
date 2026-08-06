/**
 * The interactive checklist on one firing of a TODO reminder: a checkbox per item
 * plus an "n of m done" progress line, and a control to hide the ticked ones.
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
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
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
  hideChecked = false,
  onHideCheckedChange,
  disabled,
  confirmable = true
}: {
  items: TodoItem[]
  checkedItemIds: readonly string[]
  onToggle: (itemId: string, checked: boolean) => void
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
  if (items.length === 0) return null
  const checked = new Set(checkedItemIds)
  const { done, total } = todoProgress(items, checkedItemIds)
  const allDone = done === total
  // Ticking is the only way to hide an item, and unticking is the only way back —
  // so the control stays visible while anything is hidden, however few are left.
  const visible = hideChecked ? items.filter((item) => !checked.has(item.id)) : items

  return (
    <Box>
      <Stack spacing={0.25} sx={{ mb: visible.length > 0 ? 1 : 0 }}>
        {visible.map((item) => {
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
      <Stack
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
      </Stack>
    </Box>
  )
}
