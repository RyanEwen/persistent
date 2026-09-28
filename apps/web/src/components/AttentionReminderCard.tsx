/** A due reminder preview. All actions live in its reading dialog. */
import Typography from '@mui/joy/Typography'
import SnoozeIcon from '@mui/icons-material/Snooze'
import type { Occurrence, Reminder } from '@persistent/shared'
import { formatWhen, type TimeFormat } from '../lib/datetime.js'
import { FiringStatusChip } from './FiringStatusChip.js'
import { firingTone } from '../lib/firingTone.js'
import { useReminderDialogs } from './reminderDialogContext.js'
import { ReminderPreviewCard } from './ReminderPreviewCard.js'
import { sharingState } from './sharingState.js'

export function AttentionReminderCard({ reminder, occurrence, timeFormat, timeZone, received }: {
  reminder: Reminder
  occurrence: Occurrence
  timeFormat: TimeFormat
  timeZone?: string
  received?: boolean
}) {
  const dialogs = useReminderDialogs()
  const { color, variant } = firingTone(reminder, occurrence)
  return (
    <ReminderPreviewCard
      reminder={reminder}
      onOpen={() => dialogs.view(reminder.id)}
      color={color}
      variant={variant}
      status={<FiringStatusChip reminder={reminder} occurrence={occurrence} />}
      sharing={received ? 'shared' : sharingState(reminder)}
      checkedItemIds={occurrence.checkedItemIds}
      when={formatWhen(occurrence.scheduledFor, timeFormat, timeZone)}
      afterWhen={occurrence.status === 'SNOOZED' && occurrence.snoozedUntil ? (
        <Typography level="body-xs" color="primary" startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}>
          Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat, timeZone)}
        </Typography>
      ) : undefined}
    />
  )
}
