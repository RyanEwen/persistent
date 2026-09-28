/** Full-content note previews that open a reading dialog on tap. */
import Stack from '@mui/joy/Stack'
import Chip from '@mui/joy/Chip'
import type { Reminder } from '@persistent/shared'
import { isNote } from '../lib/notes.js'
import { SectionHeading } from './SectionHeading.js'
import { useReminderDialogs } from './reminderDialogContext.js'
import { ReminderPreviewCard } from './ReminderPreviewCard.js'
import { sharingState } from './sharingState.js'

export function NotesSection({ reminders, receivedIds = new Set<string>() }: {
  reminders: readonly Reminder[]
  receivedIds?: ReadonlySet<string>
}) {
  const dialogs = useReminderDialogs()
  const notes = reminders.filter(isNote)
  if (notes.length === 0) return null

  return (
    <Stack spacing={1.5}>
      <SectionHeading title="Notes" subtitle="Reminders set not to notify you." />
      <Stack spacing={1.5}>
        {notes.map((reminder) => (
          <ReminderPreviewCard
            key={reminder.id}
            reminder={reminder}
            onOpen={() => dialogs.view(reminder.id)}
            checkedItemIds={reminder.checkedItemIds}
            sharing={receivedIds.has(reminder.id) ? 'shared' : sharingState(reminder)}
            status={!reminder.active ? <Chip size="sm" color="neutral" variant="outlined">paused</Chip> : undefined}
          />
        ))}
      </Stack>
    </Stack>
  )
}
