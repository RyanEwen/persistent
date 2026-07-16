/**
 * History: past entries — occurrences that were acknowledged or missed, most
 * recent first. Rendered the same way as the current list, and each links to its
 * reminder's detail view (where it can be opened, edited, or revived).
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import { reminderBodyText } from '@persistent/shared'
import { usePastOccurrences } from '../data/occurrences.js'
import { formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

export function HistoryPage() {
  const past = usePastOccurrences()
  const { timeFormat } = useSettings()

  return (
    <PullToRefresh onRefresh={() => past.refetch()}>
    <Stack spacing={2}>
      <Typography level="title-lg">History</Typography>

      {past.isLoading && <Typography level="body-sm">Loading…</Typography>}
      {past.data && past.data.length === 0 && (
        <Typography level="body-sm">Nothing here yet. Done and missed reminders show up here.</Typography>
      )}

      <Stack spacing={1.5}>
        {past.data?.map((occurrence) => (
          <ReminderListItem
            key={occurrence.id}
            to={`/reminders/${occurrence.reminderId}`}
            category={occurrence.reminder.category}
            title={occurrence.reminder.title}
            status={occurrence.status}
            description={reminderBodyText(occurrence.reminder)}
            subtitle={formatWhen(occurrence.scheduledFor, timeFormat)}
          />
        ))}
      </Stack>
    </Stack>
    </PullToRefresh>
  )
}
