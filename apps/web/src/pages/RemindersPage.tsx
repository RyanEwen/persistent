/**
 * Main view: one card per reminder. Reminders that need attention
 * (a FIRED/ESCALATED/SNOOZED occurrence) float to the top with the warning
 * styling + Done/Snooze/Silence buttons; the rest follow in soonest-fire order.
 */
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Chip from '@mui/joy/Chip'
import { reminderBodyText } from '@persistent/shared'
import type { Occurrence, Reminder } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences, useAckOccurrence, useSnoozeOccurrence, useSilenceOccurrence } from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'
import { formatWhen } from '../lib/datetime.js'
import { reminderNextFire } from '../lib/schedule-preview.js'
import { useSettings } from '../settings/useSettings.js'
import { AttentionReminderCard } from '../components/AttentionReminderCard.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { SnoozeDialog } from '../components/SnoozeDialog.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

// A one-time reminder that's been done (acknowledged) is finished — it lives in
// History, not the Current list. Missed/snoozed are still actionable, so they
// stay current, and repeating reminders always do (they keep recurring).
function isFinished(reminder: Reminder): boolean {
  return reminder.schedule.kind === 'once' && reminder.lastOccurrence?.status === 'ACKNOWLEDGED'
}

// Most urgent first within the attention group: escalations, then by how overdue.
function attentionRank(occurrence: Occurrence): number {
  return occurrence.status === 'ESCALATED' ? 0 : 1
}

export function RemindersPage() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const silence = useSilenceOccurrence()
  const { timeFormat } = useSettings()
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)

  // At most one active occurrence per reminder (self-collapse keeps the latest);
  // if several slip through, keep the most urgent.
  const activeByReminder = new Map<string, Occurrence>()
  for (const occurrence of active.data ?? []) {
    const existing = activeByReminder.get(occurrence.reminderId)
    if (!existing || attentionRank(occurrence) < attentionRank(existing)) {
      activeByReminder.set(occurrence.reminderId, occurrence)
    }
  }

  const rows = (reminders.data?.filter((r) => !isFinished(r)) ?? []).map((reminder) => ({
    reminder,
    occurrence: activeByReminder.get(reminder.id) ?? null,
    next: reminderNextFire(reminder)
  }))
  // Attention rows first (escalations, then most overdue); the rest soonest-fire
  // first, with paused/finished (no upcoming fire) sinking to the bottom.
  rows.sort((a, b) => {
    if (a.occurrence && b.occurrence) {
      return (
        attentionRank(a.occurrence) - attentionRank(b.occurrence) ||
        new Date(a.occurrence.scheduledFor).getTime() - new Date(b.occurrence.scheduledFor).getTime()
      )
    }
    if (a.occurrence) return -1
    if (b.occurrence) return 1
    return (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity)
  })

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      <Stack spacing={3}>
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography level="title-md">Reminders</Typography>
            <Button component={RouterLink} to="/reminders/new" size="sm">
              New
            </Button>
          </Stack>

          {reminders.isLoading && <Typography level="body-sm">Loading…</Typography>}
          {reminders.data && rows.length === 0 && (
            <Typography level="body-sm">No current reminders. Add one, or check History.</Typography>
          )}

          <Stack spacing={1.5}>
            {rows.map(({ reminder, occurrence, next }) => {
              if (occurrence) {
                return (
                  <AttentionReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    occurrence={occurrence}
                    timeFormat={timeFormat}
                    onDone={() => ack.mutate({ id: occurrence.id, arg: undefined })}
                    doneLoading={ack.isPending}
                    onSnooze={() => setSnoozeFor(occurrence.id)}
                    onSilence={() => silence.mutate({ id: occurrence.id, arg: undefined })}
                    silenceLoading={silence.isPending}
                  />
                )
              }
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
