/**
 * History: past/done entries — occurrences that were acknowledged or missed,
 * most recent first. Read-only counterpart to the "current" view.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import { usePastOccurrences } from '../data/occurrences.js'
import { formatDateTime } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { CategoryIcon, StatusIcon } from '../components/ReminderIcons.js'

export function HistoryPage() {
  const past = usePastOccurrences()
  const { timeFormat } = useSettings()

  return (
    <Stack spacing={2}>
      <Typography level="title-lg">History</Typography>

      {past.isLoading && <Typography level="body-sm">Loading…</Typography>}
      {past.data && past.data.length === 0 && (
        <Typography level="body-sm">Nothing here yet. Done and missed reminders show up here.</Typography>
      )}

      <Stack spacing={1.5}>
        {past.data?.map((occurrence) => (
          <Card key={occurrence.id} variant="outlined">
            <Stack direction="row" spacing={1} alignItems="center">
              <CategoryIcon category={occurrence.reminder.category} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography level="title-sm">{occurrence.reminder.title}</Typography>
                <Typography level="body-xs">{formatDateTime(occurrence.scheduledFor, timeFormat)}</Typography>
              </Box>
              <StatusIcon status={occurrence.status} />
            </Stack>
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
