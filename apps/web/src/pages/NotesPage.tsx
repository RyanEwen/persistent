/**
 * Notes: the reminders that never fire (schedule kind `never`), kept to be read
 * rather than acted on.
 *
 * They had their own section at the foot of Current, which was the right *place* for
 * as long as there were one or two: Current is the screen the app opens on, so a door
 * code was to hand. It stops being right as the list grows — Current is a screen you
 * come to to make something go away, and a page of kept notes under it turns "is
 * anything waiting on me?" into a scroll. So they get a tab of their own.
 *
 * The tab **only exists while there is something on it** (`components/BottomNav.tsx`).
 * A note is an opt-in thing — most people never make one — and a permanently empty tab
 * would spend a fifth of the bar explaining a feature they don't use. The route stays
 * live either way, so a stale link or a save that lands here still resolves; it says
 * what a note is instead of showing an empty list.
 *
 * Nothing here has a status, a Done or a Snooze, because a note has no occurrence to
 * act on (`docs/notification-behavior.md` §7). The cards themselves are
 * `components/NotesSection.tsx`, which the editor's landing tab and this page share.
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import { SectionHeading } from '../components/SectionHeading.js'
import { NewReminderFab } from '../components/NewReminderFab.js'
import { NotesSection } from '../components/NotesSection.js'
import { PullToRefresh } from '../components/PullToRefresh.js'
import { useReminders } from '../data/reminders.js'
import { isNote } from '../lib/notes.js'

export function NotesPage() {
  const reminders = useReminders()
  const notes = (reminders.data ?? []).filter(isNote)

  return (
    <PullToRefresh onRefresh={() => reminders.refetch().then(() => undefined)}>
      <Stack spacing={3}>
        <Stack spacing={1.5}>
          {reminders.isLoading && <Typography level="body-sm">Loading…</Typography>}
          {/* Reachable with nothing on it — by link, or by deleting the last note while
              standing here — so it explains itself rather than showing a bare heading.
              The tab that leads here is hidden in exactly this state. */}
          {reminders.data && notes.length === 0 && (
            <>
              <SectionHeading title="Notes" subtitle="Reminders set not to notify you." />
              <Typography level="body-sm">
                Nothing kept here yet. Set a reminder&apos;s When to &ldquo;Never — just a note&rdquo; and it will
                sit here to read instead of notifying you.
              </Typography>
            </>
          )}

          {/* Carries its own heading, so this page adds none above it. */}
          <NotesSection reminders={reminders.data ?? []} />
        </Stack>

        <NewReminderFab />
      </Stack>
    </PullToRefresh>
  )
}
