/**
 * Main view. Each FIRED/ESCALATED/SNOOZED occurrence floats to the top as its own
 * attention card (Done/Snooze/Silence) — a reminder with several times of day can
 * show several cards at once, each confirmed independently. Reminders with nothing
 * pending follow as plain list items in soonest-fire order.
 */
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Chip from '@mui/joy/Chip'
import AddIcon from '@mui/icons-material/Add'
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

  // Every active occurrence is its own attention card — a reminder with several
  // times of day can have more than one pending at once, each acked separately.
  const reminderById = new Map((reminders.data ?? []).map((r) => [r.id, r]))
  const attention = (active.data ?? [])
    .flatMap((occurrence) => {
      const reminder = reminderById.get(occurrence.reminderId)
      return reminder ? [{ reminder, occurrence }] : []
    })
    // Escalations first, then most overdue (earliest scheduled) first.
    .sort(
      (a, b) =>
        attentionRank(a.occurrence) - attentionRank(b.occurrence) ||
        new Date(a.occurrence.scheduledFor).getTime() - new Date(b.occurrence.scheduledFor).getTime()
    )

  // Reminders with nothing pending: plain list rows, soonest-fire first, paused/
  // finished (no upcoming fire) sinking to the bottom.
  const pendingReminderIds = new Set((active.data ?? []).map((o) => o.reminderId))
  const idle = (reminders.data ?? [])
    .filter((r) => !isFinished(r) && !pendingReminderIds.has(r.id))
    .map((reminder) => ({ reminder, next: reminderNextFire(reminder) }))
    .sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity))

  const isEmpty = attention.length === 0 && idle.length === 0

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      <Stack spacing={3}>
        <Box>
          <Typography level="title-md" sx={{ mb: 1 }}>
            Reminders
          </Typography>

          {reminders.isLoading && <Typography level="body-sm">Loading…</Typography>}
          {reminders.data && isEmpty && (
            <Typography level="body-sm" sx={{ mb: 1.5 }}>
              No current reminders. Add one below, or check History.
            </Typography>
          )}

          <Stack spacing={1.5}>
            <Button
              component={RouterLink}
              to="/reminders/new"
              size="lg"
              startDecorator={<AddIcon />}
              sx={{ width: '100%' }}
            >
              New reminder
            </Button>
            {attention.map(({ reminder, occurrence }) => (
              <AttentionReminderCard
                key={occurrence.id}
                reminder={reminder}
                occurrence={occurrence}
                timeFormat={timeFormat}
                onDone={() => ack.mutate({ id: occurrence.id, arg: undefined })}
                doneLoading={ack.isPending}
                onSnooze={() => setSnoozeFor(occurrence.id)}
                onSilence={() => silence.mutate({ id: occurrence.id, arg: undefined })}
                silenceLoading={silence.isPending}
              />
            ))}
            {idle.map(({ reminder, next }) => {
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
