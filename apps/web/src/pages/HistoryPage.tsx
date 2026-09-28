/**
 * History: past entries — occurrences that were acknowledged or missed, most
 * recent first. Uses the same reminder card layout as Current and Upcoming;
 * a card opens the reading dialog with the reminder's current details.
 *
 * Loaded a page at a time (see `usePastOccurrences`). Nothing prunes confirmed
 * firings, so this list only ever grows; fetching it whole meant a bigger payload
 * and a longer render on every visit, forever. "Show more" is deliberate rather
 * than infinite scroll — history is something you occasionally go looking back
 * through, not a feed to fall into, and an explicit control keeps the page a
 * fixed, predictable length until asked otherwise.
 */
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import { todoItems, todoProgress } from '@persistent/shared'
import type { Occurrence } from '@persistent/shared'
import { usePastOccurrences } from '../data/occurrences.js'
import { formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { ReminderPreviewCard } from '../components/ReminderPreviewCard.js'
import { StatusChip } from '../components/ReminderIcons.js'
import { PullToRefresh } from '../components/PullToRefresh.js'
import { NewReminderFab } from '../components/NewReminderFab.js'
import { SectionHeading } from '../components/SectionHeading.js'
import { useAuth } from '../auth/useAuth.js'
import { useReminderDialogs } from '../components/reminderDialogContext.js'
import { useReminders } from '../data/reminders.js'
import { useReceivedShares } from '../data/shares.js'
import { sharingState } from '../components/sharingState.js'

/**
 * "2 of 3 checked" for a past checklist firing — how much of it was actually
 * ticked off. Done confirms a firing whether or not every item was ticked, so
 * this is the only place that record survives.
 */
function checklistProgress(occurrence: Occurrence): string | undefined {
  if (occurrence.reminder.type !== 'TODO') return undefined
  const { done, total } = todoProgress(todoItems(occurrence.reminder.typeData), occurrence.checkedItemIds)
  return total > 0 ? `${done} of ${total} checked` : undefined
}

export function HistoryPage() {
  const dialogs = useReminderDialogs()
  const past = usePastOccurrences()
  const reminders = useReminders()
  const received = useReceivedShares()
  const { user } = useAuth()
  const { timeFormat } = useSettings()

  // `?? []` on `pages`, not just on `data`: this key used to hold a plain
  // Occurrence[] before history was paginated, and the persisted cache is only
  // discarded on an app-version change. A restored old value has no `pages` at
  // all, and reading straight through it takes the whole view down rather than
  // one row (see the note in lib/persistQuery.ts). The version bump is the real
  // fix; this is what stops it being fatal if one ever slips through again.
  const occurrences = (past.data?.pages ?? []).flatMap((page) => page.occurrences ?? [])
  const ownedById = new Map((reminders.data ?? []).map((reminder) => [reminder.id, reminder]))
  const receivedIds = new Set((received.data ?? []).map((reminder) => reminder.id))

  return (
    <PullToRefresh onRefresh={() => past.refetch()}>
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <SectionHeading title="History" subtitle="Already dealt with, most recent first." />

        {past.isLoading && <Typography level="body-sm">Loading…</Typography>}
        {past.data && occurrences.length === 0 && (
          <Typography level="body-sm">Nothing here yet. Done and missed reminders show up here.</Typography>
        )}

        <Stack spacing={1.5}>
          {occurrences.map((occurrence) => (
            <ReminderPreviewCard
              key={occurrence.id}
              reminder={occurrence.reminder}
              sharing={receivedIds.has(occurrence.reminderId)
                ? 'shared'
                : sharingState(ownedById.get(occurrence.reminderId) ?? { shareCount: 0, invitationCount: 0 })}
              onOpen={() => dialogs.view(occurrence.reminderId)}
              status={<StatusChip status={occurrence.status} />}
              checkedItemIds={occurrence.checkedItemIds}
              when={formatWhen(occurrence.scheduledFor, timeFormat, user?.timeZone)}
              secondary={checklistProgress(occurrence)}
            />
          ))}
          {past.hasNextPage && (
            <Button
              variant="outlined"
              color="neutral"
              loading={past.isFetchingNextPage}
              onClick={() => void past.fetchNextPage()}
            >
              Show more
            </Button>
          )}
        </Stack>
      </Stack>

      <NewReminderFab />
    </Stack>
    </PullToRefresh>
  )
}
