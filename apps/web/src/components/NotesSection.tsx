/**
 * The Notes list: reminders whose schedule kind is `never`, kept to be read
 * rather than acted on.
 *
 * It sits on **Current**, below the attention cards. Current is where the app
 * opens, so it is where something you keep is actually to hand — a door code or a
 * packing list is no use behind a tab you only visit to change a schedule. The
 * section is separated by its own heading precisely because everything above it
 * needs confirming and nothing here does: a note carries no occurrence, so it has
 * no Done, no Snooze and no status of any kind.
 *
 * The one line under the heading says only that these never notify you. Anything
 * more presumes what the user keeps notes *for*, which is not the app's business.
 *
 * Renders nothing when the user has no notes. An empty "Notes" heading on the
 * app's landing screen would advertise a mode to someone who hasn't asked for one.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Chip from '@mui/joy/Chip'
import { reminderBodyText, type Reminder } from '@persistent/shared'
import { ReminderListItem } from './ReminderListItem.js'

export function NotesSection({ reminders }: { reminders: readonly Reminder[] }) {
  const notes = reminders.filter((reminder) => reminder.schedule.kind === 'never')
  if (notes.length === 0) return null

  return (
    <Box>
      <Typography level="title-md" sx={{ mb: 1 }}>
        Notes
      </Typography>
      <Typography level="body-sm" sx={{ mb: 1.5 }}>
        These never notify you.
      </Typography>
      <Stack spacing={1.5}>
        {notes.map((reminder) => (
          // No "when" line: the text above has already said these never notify,
          // and repeating it per row would be a column of identical text.
          <ReminderListItem
            key={reminder.id}
            to={`/reminders/${reminder.id}/edit`}
            type={reminder.type}
            title={reminder.title}
            description={reminderBodyText(reminder)}
            trailing={
              !reminder.active ? (
                <Chip size="sm" color="neutral" variant="outlined">
                  paused
                </Chip>
              ) : undefined
            }
          />
        ))}
      </Stack>
    </Box>
  )
}
