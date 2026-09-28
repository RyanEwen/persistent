/** One place to review every reminder shared with this account. */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import { useAuth } from '../auth/useAuth.js'
import { PullToRefresh } from '../components/PullToRefresh.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { SectionHeading } from '../components/SectionHeading.js'
import { useReminderDialogs } from '../components/reminderDialogContext.js'
import { useReceivedShares } from '../data/shares.js'
import { formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'

export function ReceivedSharesPage() {
  const dialogs = useReminderDialogs()
  const received = useReceivedShares()
  const { user } = useAuth()
  const { timeFormat } = useSettings()

  return (
    <PullToRefresh onRefresh={() => received.refetch().then(() => undefined)}>
      <Stack spacing={1.5}>
        <SectionHeading title="Shared with me" subtitle="Reminders other people have shared with you." />
        {received.isLoading && <Typography level="body-sm">Loading…</Typography>}
        {received.data?.length === 0 && (
          <Typography level="body-sm">No reminders have been shared with you yet.</Typography>
        )}
        {received.data?.map((reminder) => (
          <ReminderListItem
            key={reminder.id}
            onOpen={() => dialogs.view(reminder.id)}
            type={reminder.type}
            title={reminder.title}
            sharing="shared"
            subtitle={`From ${reminder.ownerName}${reminder.nextScheduledFor
              ? ` · Next: ${formatWhen(reminder.nextScheduledFor, timeFormat, user?.timeZone)}`
              : ''}`}
          />
        ))}
      </Stack>
    </PullToRefresh>
  )
}
