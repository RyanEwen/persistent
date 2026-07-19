/**
 * A reminder that needs attention (has an active FIRED/ESCALATED/SNOOZED
 * occurrence): the warning-styled card shown at the top of the reminders list.
 *
 * It pulls double duty as the reminder's list row — the info region links to the
 * reminder's detail view (like ReminderListItem) while the Done/Snooze/De-escalate
 * buttons act on the occurrence without navigating (they sit outside the link, not
 * nested in it). ("De-escalate" is the user-facing label for the silence action.)
 */
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Chip from '@mui/joy/Chip'
import SnoozeIcon from '@mui/icons-material/Snooze'
import HistoryIcon from '@mui/icons-material/History'
import { reminderBodyText, type Occurrence, type Reminder } from '@persistent/shared'
import { formatWhen } from '../lib/datetime.js'
import type { TimeFormat } from '../lib/datetime.js'
import { isOutsideReminderWindow } from '../lib/occurrenceSchedule.js'
import { CategoryIcon, StatusChip } from './ReminderIcons.js'
import { OccurrenceActions } from './OccurrenceActions.js'

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
  // Fired before the reminder's current start/end window — the schedule was edited
  // after this one fired. It still needs an explicit action (only the user clears a
  // firing), but calling it "Due" hides why a reminder starting later is nagging now.
  const orphaned = isOutsideReminderWindow(reminder, occurrence)
  return (
    <Card color="warning" variant="soft">
      {/* Two columns: the tappable info region on the left, the status chip and the
          action buttons stacked on the right. The buttons sit beside the text rather
          than below it so they consume the text block's existing height instead of
          adding a row to the card.
          The row wraps once the text would drop below 8.5rem — an escalated occurrence
          carries a third button (De-escalate), which at phone widths would otherwise
          crush the title and details to one word per line. Wrapping puts the chip and
          buttons on their own right-aligned row instead.*/}
      {/* The buttons stay outside the link so they act without navigating.
          Use Box (not Joy Link) so the nested Typography lines stay block-level —
          Joy Link forces descendant Typography inline, collapsing them onto one row. */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
      >
        <Box
          component={RouterLink}
          to={`/reminders/${reminder.id}`}
          sx={{ color: 'inherit', display: 'block', textDecoration: 'none', flex: '1 1 8.5rem', minWidth: '8.5rem' }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <CategoryIcon category={reminder.category} />
            <Typography level="title-md">{reminder.title}</Typography>
          </Stack>
          {/* pre-wrap so the line breaks the user typed into details survive. */}
          {body && <Typography level="body-sm" sx={{ whiteSpace: 'pre-wrap' }}>{body}</Typography>}
          <Typography level="body-xs" sx={{ mt: 0.5 }}>
            {formatWhen(occurrence.scheduledFor, timeFormat)}
          </Typography>
          {occurrence.status === 'SNOOZED' && occurrence.snoozedUntil && (
            <Typography level="body-xs" color="primary" startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}>
              Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat)}
            </Typography>
          )}
        </Box>
        <Stack spacing={1} alignItems="flex-end" sx={{ flexShrink: 0, ml: 'auto' }}>
          {orphaned ? (
            <Chip size="sm" variant="soft" color="warning" startDecorator={<HistoryIcon sx={{ fontSize: 14 }} />}>
              Unconfirmed
            </Chip>
          ) : (
            <StatusChip status={occurrence.status} />
          )}
          <OccurrenceActions
            size="sm"
            doneLabel={orphaned ? 'Clear' : 'Done'}
            occurrence={occurrence}
            onDone={onDone}
            doneLoading={doneLoading}
            onSnooze={onSnooze}
            onSilence={onSilence}
            silenceLoading={silenceLoading}
          />
        </Stack>
      </Stack>
      {/* Full width, below the row: the sentence needs the whole card to read as one
          line or two, not the narrow column left over beside the buttons. */}
      {orphaned && (
        <Typography level="body-xs" color="warning" sx={{ mt: 0.5 }}>
          Fired before this reminder was rescheduled. Clearing it won't affect the new schedule.
        </Typography>
      )}
    </Card>
  )
}
