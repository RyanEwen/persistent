/**
 * Main view: a "Due now / needs confirmation" feed (fired/escalated/snoozed
 * occurrences with big Done/Snooze buttons) above the list of reminders.
 */
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Chip from '@mui/joy/Chip'
import Divider from '@mui/joy/Divider'
import { reminderBodyText } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences, useAckOccurrence, useSnoozeOccurrence } from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'
import { formatWhen } from '../lib/datetime.js'
import { reminderNextFire } from '../lib/schedule-preview.js'
import { useSettings } from '../settings/useSettings.js'
import { CategoryIcon, StatusIcon } from '../components/ReminderIcons.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { SnoozeDialog } from '../components/SnoozeDialog.js'
import { PullToRefresh } from '../components/PullToRefresh.js'
import type { Reminder } from '@persistent/shared'

// A one-time reminder that's been done (acknowledged) is finished — it lives in
// History, not the Current list. Missed/snoozed are still actionable, so they
// stay current, and repeating reminders always do (they keep recurring).
function isFinished(reminder: Reminder): boolean {
  return reminder.schedule.kind === 'once' && reminder.lastOccurrence?.status === 'ACKNOWLEDGED'
}

export function RemindersPage() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const { timeFormat } = useSettings()
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)
  // Soonest first; reminders with no upcoming fire (paused/finished) sink to the bottom.
  const currentReminders = (reminders.data?.filter((r) => !isFinished(r)) ?? [])
    .map((r) => ({ reminder: r, next: reminderNextFire(r) }))
    .sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity))

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
    <Stack spacing={3}>
      {active.data && active.data.length > 0 && (
        <Box>
          <Typography level="title-md" sx={{ mb: 1 }}>
            Needs confirmation
          </Typography>
          <Stack spacing={1.5}>
            {active.data.map((occurrence) => (
              <Card key={occurrence.id} color="warning" variant="soft">
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CategoryIcon category={occurrence.reminder.category} />
                      <Typography level="title-md">{occurrence.reminder.title}</Typography>
                      <StatusIcon status={occurrence.status} />
                    </Stack>
                    {reminderBodyText(occurrence.reminder) && (
                      <Typography level="body-sm">{reminderBodyText(occurrence.reminder)}</Typography>
                    )}
                    <Typography level="body-xs" sx={{ mt: 0.5 }}>
                      {formatWhen(occurrence.scheduledFor, timeFormat)}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
                  <Button
                    color="success"
                    loading={ack.isPending}
                    onClick={() => ack.mutate({ id: occurrence.id, arg: undefined })}
                  >
                    Done
                  </Button>
                  <Button variant="outlined" color="neutral" onClick={() => setSnoozeFor(occurrence.id)}>
                    Snooze
                  </Button>
                </Stack>
              </Card>
            ))}
          </Stack>
          <Divider sx={{ mt: 3 }} />
        </Box>
      )}

      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography level="title-md">Reminders</Typography>
          <Button component={RouterLink} to="/reminders/new" size="sm">
            New
          </Button>
        </Stack>

        {reminders.isLoading && <Typography level="body-sm">Loading…</Typography>}
        {reminders.data && currentReminders.length === 0 && (
          <Typography level="body-sm">No current reminders. Add one, or check History.</Typography>
        )}

        <Stack spacing={1.5}>
          {currentReminders.map(({ reminder, next }) => {
            const isRepeating = reminder.schedule.kind !== 'once'
            const when = next ? formatWhen(next, timeFormat) : 'Paused'
            return (
              <ReminderListItem
                key={reminder.id}
                to={`/reminders/${reminder.id}`}
                category={reminder.category}
                title={reminder.title}
                status={reminder.lastOccurrence?.status}
                description={reminderBodyText(reminder)}
                subtitle={when}
                secondary={isRepeating ? scheduleSummary(reminder.schedule, timeFormat) : undefined}
                trailing={
                  !reminder.active ? (
                    <Chip size="sm" color="neutral" variant="outlined">
                      paused
                    </Chip>
                  ) : undefined
                }
              />
            )
          })}
        </Stack>
      </Box>

      <SnoozeDialog
        open={snoozeFor !== null}
        busy={snooze.isPending}
        onClose={() => setSnoozeFor(null)}
        onSnooze={(minutes) => {
          if (snoozeFor) snooze.mutate({ id: snoozeFor, arg: minutes })
          setSnoozeFor(null)
        }}
      />
    </Stack>
    </PullToRefresh>
  )
}
