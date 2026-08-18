/**
 * A reminder that needs attention (has an active FIRED/ESCALATED/SNOOZED
 * occurrence): the warning-styled card shown at the top of the reminders list.
 *
 * It pulls double duty as the reminder's list row — the info region links to the
 * editor (in the app the user already has the reminder in front of them, so the
 * detail view would be a stop on the way) while the Done/Snooze/De-escalate buttons
 * act on the occurrence without navigating (they sit outside the link, not nested in
 * it). ("De-escalate" is the user-facing label for the silence action.)
 *
 * The action row repeats that link as an icon-only Edit, and a checklist's add row
 * writes the reminder's items: between them, the two things a nag most often needs —
 * fix this, or add to this — no longer mean finding your way into the editor first.
 */
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import SnoozeIcon from '@mui/icons-material/Snooze'
import { reminderBodyText, todoItems, type Occurrence, type Reminder, type TodoItem } from '@persistent/shared'
import { formatWhen } from '../lib/datetime.js'
import type { TimeFormat } from '../lib/datetime.js'
import { TypeIcon } from './ReminderIcons.js'
import { FiringStatusChip } from './FiringStatusChip.js'
import { firingTone } from '../lib/firingTone.js'
import { OccurrenceActions } from './OccurrenceActions.js'
import { TodoChecklist } from './TodoChecklist.js'

export function AttentionReminderCard({
  reminder,
  occurrence,
  timeFormat,
  onDone,
  doneLoading,
  onSnooze,
  onSilence,
  silenceLoading,
  onToggleItem,
  onAddItem,
  onRenameItem,
  onReorderItems,
  onHideChecked
}: {
  reminder: Reminder
  occurrence: Occurrence
  timeFormat: TimeFormat
  onDone: () => void
  doneLoading: boolean
  onSnooze: () => void
  onSilence: () => void
  silenceLoading: boolean
  onToggleItem: (itemId: string, checked: boolean) => void
  /** Add an item to the checklist here rather than in the editor — see TodoChecklist. */
  onAddItem: (item: TodoItem) => void
  /** Save new text for one checklist item — also a reminder write. */
  onRenameItem: (itemId: string, text: string) => void
  /** Store a new order for the checklist (the full id list) — also a reminder write. */
  onReorderItems: (itemIds: string[]) => void
  /** Collapse/expand the ticked items. Stored on the reminder, so it holds across devices. */
  onHideChecked: (hidden: boolean) => void
}) {
  // A checklist renders as real checkboxes below, so the body text drops the
  // bulleted copy of it that reminderBodyText builds for notifications. The editor
  // saves no details on a checklist (the list is the description), so this is
  // normally empty — it still renders any a pre-checklist row carried in.
  const items = reminder.type === 'TODO' ? todoItems(reminder.typeData) : []
  const body = items.length > 0 ? (reminder.details ?? '') : reminderBodyText(reminder)
  // How loudly this firing presents itself, and whether "Due" is honest for it —
  // an escalation shouts, an ordinary due reminder is outlined, and a firing with
  // no deadline behind it is quieter still (and either reads as Unconfirmed or
  // drops its chip entirely). See FiringStatusChip.
  const { orphaned, color, variant, doneLabel } = firingTone(reminder, occurrence)
  return (
    <Card color={color} variant={variant}>
      {/* Two columns: the tappable info region on the left, the status chip and the
          action buttons stacked on the right. The buttons sit beside the text rather
          than below it so they consume the text block's existing height instead of
          adding a row to the card.
          The row wraps once the text would drop below 8.5rem — the action row runs to
          four controls on an escalated occurrence (icon Edit, De-escalate, icon Snooze,
          Done), which at phone widths would otherwise crush the title and details to
          one word per line. Wrapping puts the chip and buttons on their own
          right-aligned row instead.*/}
      {/* The buttons stay outside the link so they act without navigating.
          Use Box (not Joy Link) so the nested Typography lines stay block-level —
          Joy Link forces descendant Typography inline, collapsing them onto one row. */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
      >
        <Box
          component={RouterLink}
          to={`/reminders/${reminder.id}/edit`}
          sx={{ color: 'inherit', display: 'block', textDecoration: 'none', flex: '1 1 8.5rem', minWidth: '8.5rem' }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <TypeIcon type={reminder.type} />
            <Typography level="title-md">{reminder.title}</Typography>
          </Stack>
          {/* pre-wrap so the line breaks the user typed into details survive. */}
          {body && <Typography level="body-sm" sx={{ whiteSpace: 'pre-wrap' }}>{body}</Typography>}
          <Typography level="body-xs" sx={{ mt: 0.5 }}>
            {formatWhen(occurrence.scheduledFor, timeFormat)}
          </Typography>
          {occurrence.status === 'SNOOZED' && occurrence.snoozedUntil && (
            <Typography level="body-xs" color="primary" startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}>
              Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat)}
            </Typography>
          )}
        </Box>
        <Stack spacing={1} alignItems="flex-end" sx={{ flexShrink: 0, ml: 'auto' }}>
          <FiringStatusChip reminder={reminder} occurrence={occurrence} />
          <OccurrenceActions
            size="sm"
            doneLabel={doneLabel}
            // The card body links to the editor too, but only as a whole-card tap —
            // an explicit control is what makes editing findable, and it belongs
            // with the other things you can do to what's on the card.
            editHref={`/reminders/${reminder.id}/edit`}
            occurrence={occurrence}
            onDone={onDone}
            doneLoading={doneLoading}
            onSnooze={onSnooze}
            onSilence={onSilence}
            silenceLoading={silenceLoading}
          />
        </Stack>
      </Stack>
      {/* Full width, below the row, and outside the link — a checkbox tap must tick
          the item, not navigate to the reminder. Ticking never confirms the firing;
          Done above still does (docs/notification-behavior.md §1a). */}
      {items.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          <TodoChecklist
            items={items}
            checkedItemIds={occurrence.checkedItemIds}
            onToggle={onToggleItem}
            // Adding writes the reminder, not this firing: the item joins the
            // definition, so it turns up on every later firing too. It arrives
            // unticked, so it also joins this nag's notification body.
            onAddItem={onAddItem}
            // Renaming is a definition write as well: the wording a firing shows, and
            // the line in its notification body, both come from the item.
            onRenameItem={onRenameItem}
            // Order is part of the definition too, so a drag here re-orders the list
            // every later firing shows — and the lines of its notification body.
            onReorder={onReorderItems}
            hideChecked={reminder.hideCheckedItems}
            onHideCheckedChange={onHideChecked}
          />
        </Box>
      )}
      {/* Full width, below the row: the sentence needs the whole card to read as one
          line or two, not the narrow column left over beside the buttons. */}
      {orphaned && (
        <Typography level="body-xs" sx={{ mt: 0.5, color: 'text.tertiary' }}>
          Notified you before this reminder was rescheduled. Clearing it won't affect the new schedule.
        </Typography>
      )}
    </Card>
  )
}
