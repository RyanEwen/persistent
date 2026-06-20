/**
 * Main view: a "Due now / needs confirmation" feed (fired/escalated/snoozed
 * occurrences with big Done/Snooze buttons) above the list of reminders.
 */
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Chip from '@mui/joy/Chip'
import Divider from '@mui/joy/Divider'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences, useAckOccurrence, useSnoozeOccurrence } from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'

export function RemindersPage() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()

  return (
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
                    <Typography level="title-md">{occurrence.reminder.title}</Typography>
                    {occurrence.reminder.details && (
                      <Typography level="body-sm">{occurrence.reminder.details}</Typography>
                    )}
                    <Typography level="body-xs" sx={{ mt: 0.5 }}>
                      {new Date(occurrence.scheduledFor).toLocaleString()}
                      {occurrence.status === 'ESCALATED' && ' · escalated'}
                      {occurrence.status === 'SNOOZED' && ' · snoozed'}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    color="success"
                    loading={ack.isPending}
                    onClick={() => ack.mutate({ id: occurrence.id, arg: undefined })}
                  >
                    Done
                  </Button>
                  <Button
                    variant="outlined"
                    color="neutral"
                    loading={snooze.isPending}
                    onClick={() => snooze.mutate({ id: occurrence.id, arg: 10 })}
                  >
                    Snooze 10m
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
        {reminders.data && reminders.data.length === 0 && (
          <Typography level="body-sm">No reminders yet. Add your first one.</Typography>
        )}

        <Stack spacing={1.5}>
          {reminders.data?.map((reminder) => (
            <Card
              key={reminder.id}
              component={RouterLink}
              to={`/reminders/${reminder.id}`}
              variant="outlined"
              sx={{ textDecoration: 'none' }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography level="title-sm">{reminder.title}</Typography>
                  <Typography level="body-xs">{scheduleSummary(reminder.schedule)}</Typography>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <Chip size="sm" variant="soft">
                    {reminder.category.toLowerCase()}
                  </Chip>
                  {!reminder.active && (
                    <Chip size="sm" color="neutral" variant="outlined">
                      paused
                    </Chip>
                  )}
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}
