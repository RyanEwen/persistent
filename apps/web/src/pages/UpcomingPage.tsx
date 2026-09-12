/**
 * Upcoming: every reminder that isn't nagging right now, in soonest-fire order,
 * with paused and finished ones sinking to the bottom.
 *
 * This is also the app's *management* list — the place you come to look over what
 * you have set up and change it — so rows open the editor directly, and the New
 * reminder action (`components/NewReminderFab.tsx`, a floating button shared with
 * Current and History) is to hand here too.
 *
 * Reminders with an active firing are deliberately absent: they are on Current,
 * as attention cards with their own Done/Snooze. One reminder therefore appears in
 * exactly one of the two tabs at a time, which is what stops a busy morning
 * listing the same thing twice with different affordances.
 *
 * **Notes** (schedule kind `never`) are absent for the same reason — they have their
 * own tab (`pages/NotesPage.tsx`). Nothing about them is upcoming or ever will be, so
 * listing them here would put them in a queue they can never reach the front of.
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import Chip from '@mui/joy/Chip'
import { SectionHeading } from '../components/SectionHeading.js'
import { NewReminderFab } from '../components/NewReminderFab.js'
import { reminderBodyText } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences } from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'
import { formatWhen } from '../lib/datetime.js'
import { selectUpcomingReminders } from '../lib/upcomingReminders.js'
import { useSettings } from '../settings/useSettings.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

export function UpcomingPage() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const { timeFormat } = useSettings()

  const idle = selectUpcomingReminders(reminders.data ?? [], active.data ?? [])

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      <Stack spacing={3}>
        <Stack spacing={1.5}>
          <SectionHeading title="Upcoming" subtitle="Everything coming up, soonest first." />

          {reminders.isLoading && <Typography level="body-sm">Loading…</Typography>}
          {reminders.data && idle.length === 0 && (
            <Typography level="body-sm">Nothing scheduled. Anything due right now is on Current.</Typography>
          )}

          <Stack spacing={1.5}>
            {/* No status chip on these rows: `lastOccurrence` is always a *past*
                firing here, in practice always ACKNOWLEDGED, so the chip was a
                constant reading "Done" beside a subtitle giving the *next* fire
                time. The row is about what is coming; the last firing is what
                History is for. */}
            {idle.map(({ reminder, next }) => {
              const isRepeating = reminder.schedule.kind !== 'once'
              const when = next ? formatWhen(next, timeFormat) : 'Paused'
              return (
                <ReminderListItem
                  key={reminder.id}
                  to={`/reminders/${reminder.id}/edit`}
                  type={reminder.type}
                  title={reminder.title}
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
        </Stack>

        <NewReminderFab />
      </Stack>
    </PullToRefresh>
  )
}
