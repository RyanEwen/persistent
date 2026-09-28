/** Shared card layout for Current, Upcoming, and Notes reminder previews. */
import type { ComponentProps, ReactNode } from 'react'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import { TypeIcon } from './ReminderIcons.js'
import { ChecklistPreview } from './ChecklistPreview.js'
import { reminderPreviewBody, type ReminderPreviewSource } from '../lib/reminderPreview.js'
import { reminderCardHover } from './reminderCardHover.js'
import { SharingChip } from './SharingChip.js'
import type { SharingState } from './sharingState.js'

/** The card is one button; its status and checklist rows are visual content. */
export function ReminderPreviewCard({
  reminder,
  onOpen,
  status,
  sharing,
  when,
  afterWhen,
  secondary,
  checkedItemIds,
  color,
  variant = 'outlined'
}: {
  reminder: ReminderPreviewSource
  onOpen: () => void
  status?: ReactNode
  sharing?: SharingState
  when?: string
  afterWhen?: ReactNode
  secondary?: string
  checkedItemIds?: readonly string[]
  color?: ComponentProps<typeof Card>['color']
  variant?: ComponentProps<typeof Card>['variant']
}) {
  const body = reminderPreviewBody(reminder)

  return (
    <Card
      component="button"
      type="button"
      onClick={onOpen}
      color={color}
      variant={variant}
      size="sm"
      sx={{ width: '100%', textAlign: 'left', cursor: 'pointer', ...reminderCardHover }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TypeIcon type={reminder.type} size={20} />
        <Typography level="title-sm" sx={{ flex: 1, minWidth: 0 }}>
          {reminder.title}
        </Typography>
        {(status || sharing) && (
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
            {status}
            <SharingChip state={sharing} />
          </Stack>
        )}
      </Stack>
      {body && (
        <Typography level="body-sm" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
          {body}
        </Typography>
      )}
      <ChecklistPreview reminder={reminder} checkedItemIds={checkedItemIds} />
      {when && <Typography level="body-xs">{when}</Typography>}
      {afterWhen}
      {secondary && (
        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
          {secondary}
        </Typography>
      )}
    </Card>
  )
}
