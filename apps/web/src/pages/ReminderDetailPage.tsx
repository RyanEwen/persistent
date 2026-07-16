/**
 * Single-reminder detail: a focused, mostly read-only view of one reminder with
 * its active occurrences' Done / Snooze / De-escalate actions. This is where a
 * notification tap and a list-row tap land — editing is one step away, behind the
 * Edit button, so the common case (confirm / snooze a nag) is front and center and
 * the large tabbed form isn't in the way.
 *
 * Every active occurrence of the reminder is confirmed independently (a reminder
 * with several times of day can have more than one pending at once), mirroring the
 * attention cards on the main list.
 */
import { useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Chip from '@mui/joy/Chip'
import SnoozeIcon from '@mui/icons-material/Snooze'
import EditIcon from '@mui/icons-material/Edit'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { reminderBodyText } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences, useAckOccurrence, useSnoozeOccurrence, useSilenceOccurrence } from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'
import { formatWhen } from '../lib/datetime.js'
import { reminderNextFire } from '../lib/schedule-preview.js'
import { useSettings } from '../settings/useSettings.js'
import { CategoryIcon, StatusChip } from '../components/ReminderIcons.js'
import { OccurrenceActions } from '../components/OccurrenceActions.js'
import { SnoozeDialog } from '../components/SnoozeDialog.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

export function ReminderDetailPage() {
  const { id } = useParams()
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const silence = useSilenceOccurrence()
  const { timeFormat } = useSettings()
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)

  const reminder = reminders.data?.find((r) => r.id === id)

  // The reminder may still be loading (deep link from a notification) or gone.
  if (!reminder) {
    return (
      <Stack spacing={2}>
        {reminders.isLoading ? (
          <Typography level="body-sm">Loading…</Typography>
        ) : (
          <>
            <Typography level="body-sm">Reminder not found.</Typography>
            <Button component={RouterLink} to="/" variant="outlined" sx={{ alignSelf: 'flex-start' }}>
              Back to reminders
            </Button>
          </>
        )}
      </Stack>
    )
  }

  const body = reminderBodyText(reminder)
  const next = reminderNextFire(reminder)
  // Each pending occurrence gets its own action block, soonest (most overdue) first.
  const occurrences = (active.data ?? [])
    .filter((o) => o.reminderId === reminder.id)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Button
            component={RouterLink}
            to="/"
            variant="plain"
            color="neutral"
            size="sm"
            startDecorator={<ArrowBackIcon />}
          >
            Back
          </Button>
          <Button
            component={RouterLink}
            to={`/reminders/${reminder.id}/edit`}
            variant="outlined"
            size="sm"
            startDecorator={<EditIcon />}
          >
            Edit
          </Button>
        </Stack>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <CategoryIcon category={reminder.category} />
            <Typography level="title-lg" sx={{ minWidth: 0 }}>
              {reminder.title}
            </Typography>
            {!reminder.active && (
              <Chip size="sm" color="neutral" variant="outlined">
                paused
              </Chip>
            )}
          </Stack>
          {body && (
            <Typography level="body-sm" sx={{ mt: 0.5 }}>
              {body}
            </Typography>
          )}
        </Box>

        <Card variant="soft">
          <Typography level="title-sm">Schedule</Typography>
          <Typography level="body-sm">{scheduleSummary(reminder.schedule, timeFormat)}</Typography>
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
            {next ? `Next: ${formatWhen(next, timeFormat)}` : 'Paused — no upcoming fire'}
          </Typography>
        </Card>

        {occurrences.length > 0 && (
          <Stack spacing={1.5}>
            <Typography level="title-sm">Needs attention</Typography>
            {occurrences.map((occurrence) => (
              <Card key={occurrence.id} color="warning" variant="soft">
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography level="body-sm">{formatWhen(occurrence.scheduledFor, timeFormat)}</Typography>
                    {occurrence.status === 'SNOOZED' && occurrence.snoozedUntil && (
                      <Typography
                        level="body-xs"
                        color="primary"
                        startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}
                      >
                        Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat)}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ flexShrink: 0 }}>
                    <StatusChip status={occurrence.status} />
                  </Box>
                </Stack>
                <Box sx={{ mt: 1 }}>
                  <OccurrenceActions
                    occurrence={occurrence}
                    onDone={() => ack.mutate({ id: occurrence.id, arg: undefined })}
                    doneLoading={ack.isPending}
                    onSnooze={() => setSnoozeFor(occurrence.id)}
                    onSilence={() => silence.mutate({ id: occurrence.id, arg: undefined })}
                    silenceLoading={silence.isPending}
                  />
                </Box>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      <SnoozeDialog
        open={snoozeFor !== null}
        busy={snooze.isPending}
        onClose={() => setSnoozeFor(null)}
        onSnooze={(minutes) => {
          if (snoozeFor) snooze.mutate({ id: snoozeFor, arg: minutes })
          setSnoozeFor(null)
        }}
      />
    </PullToRefresh>
  )
}
