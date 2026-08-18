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
 * **A note shows its whole body, like an attention card does** — checklist items
 * one per line, medications, and details with their line breaks intact. It is not
 * a compact single-line row: those exist to fit many *scheduled* reminders on a
 * phone screen, where the content is a reminder of something you already know. A
 * note IS its content, so truncating it to one line and making the user open it
 * defeats the point of keeping it.
 *
 * A note's checklist is **tickable**, exactly like a firing's. The ticks go on the
 * reminder itself rather than an occurrence (`Reminder.checkedItems`), which is
 * only coherent because a note has no occurrences: there is no firing whose record
 * of "what was done this time" it could contradict. See
 * docs/notification-behavior.md §7. What it does *not* get is the "tap Done to
 * confirm" line — there is no firing to confirm.
 *
 * The list is **extendable** from the card too (the add row), which is where that
 * matters most: a kept list is the thing most often added to, and adding writes the
 * reminder's items whatever kind of reminder it is, so a note needs no special case
 * for it. Editing the rest of the note is one tap either way — the card links to the
 * editor, and the Edit button says so.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Chip from '@mui/joy/Chip'
import IconButton from '@mui/joy/IconButton'
import Typography from '@mui/joy/Typography'
import EditIcon from '@mui/icons-material/Edit'
import { Link as RouterLink } from 'react-router-dom'
import { reminderBodyText, todoItems, type Reminder } from '@persistent/shared'
import {
  useAddTodoItem,
  useCheckReminderItem,
  useReorderTodoItems,
  useSetHideCheckedItems
} from '../data/reminders.js'
import { isNote } from '../lib/notes.js'
import { TypeIcon } from './ReminderIcons.js'
import { TodoChecklist } from './TodoChecklist.js'
import { SectionHeading } from './SectionHeading.js'

export function NotesSection({ reminders }: { reminders: readonly Reminder[] }) {
  const notes = reminders.filter((reminder) => reminder.schedule.kind === 'never')
  if (notes.length === 0) return null

  return (
    <Stack spacing={1.5}>
      <SectionHeading title="Notes" subtitle="Reminders set not to notify you." />
      <Stack spacing={1.5}>
        {notes.map((reminder) => (
          <NoteCard key={reminder.id} reminder={reminder} />
        ))}
      </Stack>
    </Stack>
  )
}

function NoteCard({ reminder }: { reminder: Reminder }) {
  const checkItem = useCheckReminderItem()
  const addItem = useAddTodoItem()
  const reorderItems = useReorderTodoItems()
  const hideChecked = useSetHideCheckedItems()

  // A checklist renders as its own lines below, so the body text drops the
  // bulleted copy `reminderBodyText` builds for notifications — the same split the
  // attention card makes. A TODO saves no separate details, so this is normally
  // empty for one.
  const items = reminder.type === 'TODO' ? todoItems(reminder.typeData) : []
  const body = items.length > 0 ? (reminder.details ?? '') : reminderBodyText(reminder)

  return (
    <Card variant="outlined" size="sm">
      {/* Only the title and body link to the editor. The Edit button beside them and
          the checklist below both sit OUTSIDE it, the same split
          AttentionReminderCard makes: nested in the link, a checkbox tap would
          navigate instead of ticking, and the obvious fix (preventDefault) cancels
          the checkbox's own toggle along with the anchor's. A button inside an anchor
          isn't valid either way. */}
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box
          component={RouterLink}
          to={`/reminders/${reminder.id}/edit`}
          sx={{ display: 'block', flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <TypeIcon type={reminder.type} size={20} />
            <Typography level="title-sm" sx={{ minWidth: 0, flex: 1 }}>
              {reminder.title}
            </Typography>
            {!reminder.active && (
              <Chip size="sm" color="neutral" variant="outlined">
                paused
              </Chip>
            )}
          </Stack>

          {/* pre-wrap: details are authored in a multi-line textarea, so the breaks
              the user typed are content. This is the whole reason a note is not a
              compact row — that row is single-line by design and would collapse them. */}
          {body && (
            <Typography level="body-sm" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
              {body}
            </Typography>
          )}
        </Box>

        {/* A note has no Done or Snooze for Edit to sit beside, so it goes where those
            would be — the top-right of the card, the same corner as on a firing. */}
        <IconButton
          component={RouterLink}
          to={`/reminders/${reminder.id}/edit`}
          size="sm"
          variant="plain"
          color="neutral"
          aria-label={`Edit ${reminder.title}`}
          title="Edit"
          sx={{ flexShrink: 0 }}
        >
          <EditIcon />
        </IconButton>
      </Stack>

      {items.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          <TodoChecklist
            items={items}
            checkedItemIds={reminder.checkedItemIds}
            confirmable={false}
            onToggle={(itemId, checked) => checkItem.mutate({ id: reminder.id, arg: { itemId, checked } })}
            // A kept list is the case where adding from the card matters most: a note
            // is *for* extending, and it has no firing whose record could disagree.
            onAddItem={(item) => addItem.mutate({ id: reminder.id, arg: item })}
            onReorder={(itemIds) => reorderItems.mutate({ id: reminder.id, arg: { itemIds } })}
            hideChecked={reminder.hideCheckedItems}
            onHideCheckedChange={(hidden) => hideChecked.mutate({ id: reminder.id, arg: { hidden } })}
          />
        </Box>
      )}
    </Card>
  )
}
