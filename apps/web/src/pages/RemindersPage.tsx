/**
 * Current: what needs dealing with right now. Each FIRED/ESCALATED/SNOOZED
 * occurrence is its own attention card (Done/Snooze/De-escalate) — a reminder with
 * several times of day can show several cards at once, each confirmed
 * independently, most recently fired first (`lib/firingOrder.ts`).
 *
 * What is merely *scheduled* lives on its own tab (`UpcomingPage`). The two answer
 * different questions — "what do I have to deal with" versus "what is coming" —
 * and ran together as one column for long enough to prove that a divider between
 * them wasn't enough separation once either group got long.
 *
 * Tapping a card opens the **editor**. In the app the user already has the
 * reminder in front of them, so the detail view is a stop on the way to the only
 * thing they came to do; the card's own actions don't need it either. The detail
 * view is reached from a **notification** tap instead (`native/nativeSync.ts` and
 * `public/push-handler.js` both navigate to `/reminders/:id`), where the user is
 * arriving cold and reading before acting is the point — and from History. Don't
 * collapse those two targets together.
 */
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import AddIcon from '@mui/icons-material/Add'
import { useReminders } from '../data/reminders.js'
import {
  useActiveOccurrences,
  useAckOccurrence,
  useSnoozeOccurrence,
  useSilenceOccurrence,
  useCheckOccurrenceItem
} from '../data/occurrences.js'
import { compareFirings } from '../lib/firingOrder.js'
import { useSettings } from '../settings/useSettings.js'
import { AttentionReminderCard } from '../components/AttentionReminderCard.js'
import { SnoozeDialog } from '../components/SnoozeDialog.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

export function RemindersPage() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const silence = useSilenceOccurrence()
  const checkItem = useCheckOccurrenceItem()
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
    // Escalations first, then whatever fired most recently (see firingOrder.ts).
    .sort((a, b) => compareFirings(a.occurrence, b.occurrence))

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      <Stack spacing={3}>
        <Box>
          <Typography level="title-md" sx={{ mb: 1 }}>
            Current
          </Typography>

          {reminders.isLoading && <Typography level="body-sm">Loading…</Typography>}
          {/* An empty Current is the *good* state — everything is confirmed — so it
              says so and points at the tab that has something to show, rather than
              reading like an error or an empty app. */}
          {reminders.data && attention.length === 0 && (
            <Typography level="body-sm" sx={{ mb: 1.5 }}>
              Nothing needs confirming right now. Check Upcoming for what's scheduled.
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
                onToggleItem={(itemId, checked) => checkItem.mutate({ id: occurrence.id, arg: { itemId, checked } })}
              />
            ))}
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
