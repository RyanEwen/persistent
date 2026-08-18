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
import type { Reminder } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import { isNote } from '../lib/notes.js'
import { useActiveOccurrences } from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'
import { formatWhen } from '../lib/datetime.js'
import { reminderNextFire } from '../lib/schedule-preview.js'
import { useSettings } from '../settings/useSettings.js'
import { ReminderListItem } from '../components/ReminderListItem.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

// A one-time reminder that's been done (acknowledged) is finished — it lives in
// History, not here. Missed/snoozed are still actionable, so they stay, and
// repeating reminders always do (they keep recurring).
function isFinished(reminder: Reminder): boolean {
  return reminder.schedule.kind === 'once' && reminder.lastOccurrence?.status === 'ACKNOWLEDGED'
}

export function UpcomingPage() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const { timeFormat } = useSettings()

  const pendingReminderIds = new Set((active.data ?? []).map((o) => o.reminderId))
  const idle = (reminders.data ?? [])
    // Notes have their own tab — nothing about one is upcoming.
    .filter((r) => !isNote(r) && !isFinished(r) && !pendingReminderIds.has(r.id))
    .map((reminder) => ({ reminder, next: reminderNextFire(reminder) }))
    .sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity))

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
