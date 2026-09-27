/** Read-only checklist rows for cards whose whole surface opens a dialog. */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import CheckIcon from '@mui/icons-material/Check'
import { todoItems } from '@persistent/shared'
import type { ReminderPreviewSource } from '../lib/reminderPreview.js'

/**
 * A visual checklist with no nested controls. The parent card remains one button,
 * while each item still looks checked or unchecked at a glance.
 */
export function ChecklistPreview({ reminder, checkedItemIds = [] }: {
  reminder: ReminderPreviewSource
  checkedItemIds?: readonly string[]
}) {
  if (reminder.type !== 'TODO') return null

  const items = todoItems(reminder.typeData)
  if (items.length === 0) return null

  const checked = new Set(checkedItemIds)
  const hiddenCount = reminder.hideCheckedItems ? items.filter((item) => checked.has(item.id)).length : 0
  const visible = reminder.hideCheckedItems ? items.filter((item) => !checked.has(item.id)) : items

  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      {visible.map((item) => {
        const isChecked = checked.has(item.id)
        return (
          <Stack key={item.id} direction="row" spacing={1} alignItems="flex-start">
            <Stack
              aria-hidden="true"
              alignItems="center"
              justifyContent="center"
              sx={{
                width: 18,
                height: 18,
                mt: '2px',
                flexShrink: 0,
                border: '1.5px solid',
                borderColor: isChecked ? 'success.500' : 'text.tertiary',
                borderRadius: '4px',
                bgcolor: isChecked ? 'success.500' : 'transparent',
                color: 'common.white'
              }}
            >
              {isChecked && <CheckIcon sx={{ fontSize: 15 }} />}
            </Stack>
            <Typography
              level="body-sm"
              sx={{
                minWidth: 0,
                whiteSpace: 'pre-wrap',
                color: isChecked ? 'text.tertiary' : 'text.secondary',
                textDecoration: isChecked ? 'line-through' : 'none'
              }}
            >
              {item.text}
            </Typography>
          </Stack>
        )
      })}
      {hiddenCount > 0 && (
        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
          {hiddenCount} checked hidden
        </Typography>
      )}
    </Stack>
  )
}
