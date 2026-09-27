/**
 * Current: what needs dealing with right now. Each FIRED/ESCALATED/SNOOZED
 * occurrence is its own attention card. A reminder with
 * several times of day can show several cards at once, each confirmed
 * independently, most recently fired first (`lib/firingOrder.ts`).
 *
 * What is merely *scheduled* lives on its own tab (`UpcomingPage`). The two answer
 * different questions — "what do I have to deal with" versus "what is coming" —
 * and ran together as one column for long enough to prove that a divider between
 * them wasn't enough separation once either group got long.
 *
 * **Notes have their own tab** (`pages/NotesPage.tsx`). They sat at the foot of this
 * screen while there were only ever one or two, but this screen answers "is anything
 * waiting on me?" — and a page of kept reference material under the answer turns that
 * into a scroll. Nothing about a note belongs to it either: no status, no Done, no
 * Snooze, because there is no occurrence to act on.
 *
 * Tapping a card opens the reading dialog. Its actions live with the full content,
 * while native notification links still resolve to the detail route.
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import { SectionHeading } from '../components/SectionHeading.js'
import { NewReminderFab } from '../components/NewReminderFab.js'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences } from '../data/occurrences.js'
import { compareFirings } from '../lib/firingOrder.js'
import { formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { AttentionReminderCard } from '../components/AttentionReminderCard.js'
import { PullToRefresh } from '../components/PullToRefresh.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { useReceivedShares } from '../data/shares.js'
import { useAuth } from '../auth/useAuth.js'
import { useSentAssignments } from '../data/assignments.js'
import Button from '@mui/joy/Button'
import { Link as RouterLink } from 'react-router-dom'
import { useReminderDialogs } from '../components/reminderDialogContext.js'

export function RemindersPage() {
  const dialogs = useReminderDialogs()
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const received = useReceivedShares()
  const sentAssignments = useSentAssignments()
  const { user } = useAuth()
  const { timeFormat } = useSettings()

  // Every active occurrence is its own attention card — a reminder with several
  // times of day can have more than one pending at once, each acked separately.
  const reminderById = new Map((reminders.data ?? []).map((r) => [r.id, r]))
  for (const share of received.data ?? []) {
    if (share.editableReminder) reminderById.set(share.id, share.editableReminder)
  }
  const attention = (active.data ?? [])
    .flatMap((occurrence) => {
      const reminder = reminderById.get(occurrence.reminderId)
      return reminder ? [{ reminder, occurrence }] : []
    })
    // Escalations first, then whatever fired most recently (see firingOrder.ts).
    .sort((a, b) => compareFirings(a.occurrence, b.occurrence))

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch(), received.refetch()])}>
      <Stack spacing={3}>
        <Stack spacing={1.5}>
          <SectionHeading title="Current" subtitle="Reminders still waiting to be confirmed." />

          {(reminders.isLoading || received.isLoading) && <Typography level="body-sm">Loading…</Typography>}
          {/* An empty Current is the *good* state — everything is confirmed — so it
              says so and points at the tab that has something to show, rather than
              reading like an error or an empty app. */}
          {reminders.data && received.data && attention.length === 0 && (
            <Typography level="body-sm">
              Nothing needs confirming right now. Check Upcoming for what's scheduled.
            </Typography>
          )}

          <Stack spacing={1.5}>
            {attention.map(({ reminder, occurrence }) => (
              <AttentionReminderCard
                key={occurrence.id}
                reminder={reminder}
                occurrence={occurrence}
                timeFormat={timeFormat}
                timeZone={received.data?.some((share) => share.id === reminder.id) ? user?.timeZone : undefined}
              />
            ))}
          </Stack>
        </Stack>

        {received.data && received.data.length > 0 && (
          <Stack spacing={1.5}>
            <SectionHeading title="Shared with me" subtitle="Reminders other people have shared with you." />
            {received.data.map((reminder) => (
              <ReminderListItem
                key={reminder.id}
                onOpen={() => dialogs.view(reminder.id)}
                type={reminder.type}
                title={reminder.title}
                subtitle={`From ${reminder.ownerName}${reminder.nextScheduledFor ? ` · Next: ${formatWhen(reminder.nextScheduledFor, timeFormat, user?.timeZone)}` : ''}`}
              />
            ))}
          </Stack>
        )}

        {sentAssignments.data && sentAssignments.data.length > 0 && (
          <Stack spacing={1.5}>
            <SectionHeading title="Assigned by me" subtitle="Track reminders you made for someone else." />
            <Button component={RouterLink} to="/assigned" variant="outlined" color="neutral">
              View assignments
            </Button>
          </Stack>
        )}

        <NewReminderFab />

      </Stack>
    </PullToRefresh>
  )
}
