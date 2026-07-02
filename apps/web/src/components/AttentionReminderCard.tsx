/**
 * A reminder that needs attention (has an active FIRED/ESCALATED/SNOOZED
 * occurrence): the warning-styled card shown at the top of the reminders list.
 *
 * It pulls double duty as the reminder's list row — the info region links to the
 * editor (like ReminderListItem) while the Done/Snooze/De-escalate buttons act on
 * the occurrence without navigating (they sit outside the link, not nested in it).
 * ("De-escalate" is the user-facing label for the silence action.)
 */
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
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
  // Done is a two-step confirm (matching the notification + full-screen alarm):
  // the first tap arms "Confirm done" / "Not yet" so a stray tap can't mark a
  // nagging reminder complete by accident.
  const [confirming, setConfirming] = useState(false)
  return (
    <Card color="warning" variant="soft">
      {/* Tap the info region to edit the reminder (same target as the plain list row).
          The buttons are a separate sibling below, so they act without navigating.
          Use Box (not Joy Link) so the nested Typography lines stay block-level —
          Joy Link forces descendant Typography inline, collapsing them onto one row. */}
      <Box
        component={RouterLink}
        to={`/reminders/${reminder.id}`}
        sx={{ color: 'inherit', display: 'block', textDecoration: 'none' }}
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
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
        {confirming ? (
          <>
            <Button color="success" loading={doneLoading} onClick={onDone}>
              Confirm done
            </Button>
            <Button variant="outlined" color="neutral" disabled={doneLoading} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </>
        ) : (
          <>
            <Button color="success" onClick={() => setConfirming(true)}>
              Done
            </Button>
            <Button variant="outlined" color="neutral" onClick={onSnooze}>
              Snooze
            </Button>
            {occurrence.status === 'ESCALATED' && (
              <Button variant="outlined" color="warning" loading={silenceLoading} onClick={onSilence}>
                De-escalate
              </Button>
            )}
          </>
        )}
      </Stack>
    </Card>
  )
}
