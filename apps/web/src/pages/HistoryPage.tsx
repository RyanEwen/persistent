/**
 * History: past entries — occurrences that were acknowledged or missed, most
 * recent first. Rendered the same way as the current list, and each links to its
 * reminder's detail view (where it can be opened, edited, or revived).
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
import { reminderBodyText, todoItems, todoProgress } from '@persistent/shared'
import type { Occurrence } from '@persistent/shared'
import { usePastOccurrences } from '../data/occurrences.js'
import { formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

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
  const past = usePastOccurrences()
  const { timeFormat } = useSettings()

  const occurrences = past.data?.pages.flatMap((page) => page.occurrences) ?? []

  return (
    <PullToRefresh onRefresh={() => past.refetch()}>
    <Stack spacing={2}>
      <Typography level="title-lg">History</Typography>

      {past.isLoading && <Typography level="body-sm">Loading…</Typography>}
      {past.data && occurrences.length === 0 && (
        <Typography level="body-sm">Nothing here yet. Done and missed reminders show up here.</Typography>
      )}

      <Stack spacing={1.5}>
        {occurrences.map((occurrence) => (
          <ReminderListItem
            key={occurrence.id}
            to={`/reminders/${occurrence.reminderId}`}
            type={occurrence.reminder.type}
            title={occurrence.reminder.title}
            status={occurrence.status}
            description={reminderBodyText(occurrence.reminder)}
            subtitle={formatWhen(occurrence.scheduledFor, timeFormat)}
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
    </PullToRefresh>
  )
}
