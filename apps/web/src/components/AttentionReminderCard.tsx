/**
 * A reminder that needs attention (has an active FIRED/ESCALATED/SNOOZED
 * occurrence): the warning-styled card shown at the top of the reminders list.
 *
 * It pulls double duty as the reminder's list row — the info region links to the
 * editor (like ReminderListItem) while the Done/Snooze/Silence buttons act on the
 * occurrence without navigating (they sit outside the link, not nested in it).
 */
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Link from '@mui/joy/Link'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import SnoozeIcon from '@mui/icons-material/Snooze'
import { reminderBodyText, type Occurrence, type Reminder } from '@persistent/shared'
import { formatWhen } from '../lib/datetime.js'
import type { TimeFormat } from '../lib/datetime.js'
import { CategoryIcon, StatusChip } from './ReminderIcons.js'

export function AttentionReminderCard({
  reminder,
  occurrence,
  timeFormat,
  onDone,
  doneLoading,
  onSnooze,
  onSilence,
  silenceLoading
}: {
  reminder: Reminder
  occurrence: Occurrence
  timeFormat: TimeFormat
  onDone: () => void
  doneLoading: boolean
  onSnooze: () => void
  onSilence: () => void
  silenceLoading: boolean
}) {
  const body = reminderBodyText(reminder)
  return (
    <Card color="warning" variant="soft">
      {/* Tap the info region to edit the reminder (same target as the plain list row).
          The buttons are a separate sibling below, so they act without navigating. */}
      <Link
        component={RouterLink}
        to={`/reminders/${reminder.id}`}
        underline="none"
        sx={{ color: 'inherit', display: 'block' }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CategoryIcon category={reminder.category} />
              <Typography level="title-md">{reminder.title}</Typography>
            </Stack>
            {body && <Typography level="body-sm">{body}</Typography>}
            <Typography level="body-xs" sx={{ mt: 0.5 }}>
              {formatWhen(occurrence.scheduledFor, timeFormat)}
            </Typography>
            {occurrence.status === 'SNOOZED' && occurrence.snoozedUntil && (
              <Typography level="body-xs" color="primary" startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}>
                Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat)}
              </Typography>
            )}
          </Box>
          <Box sx={{ flexShrink: 0 }}>
            <StatusChip status={occurrence.status} />
          </Box>
        </Stack>
      </Link>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
        <Button color="success" loading={doneLoading} onClick={onDone}>
          Done
        </Button>
        <Button variant="outlined" color="neutral" onClick={onSnooze}>
          Snooze
        </Button>
        {occurrence.status === 'ESCALATED' && (
          <Button variant="outlined" color="warning" loading={silenceLoading} onClick={onSilence}>
            Silence
          </Button>
        )}
      </Stack>
    </Card>
  )
}
