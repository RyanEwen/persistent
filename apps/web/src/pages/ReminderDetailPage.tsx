/**
 * Single-reminder detail: a reading view with focused title and note-body edits,
 * plus active occurrences' Done / Snooze / De-escalate actions. This is where a
 * **notification tap** lands, and where History links — editing is one step away,
 * behind the Edit button, so the common case (confirm / snooze a nag) is front and
 * center and the large tabbed form isn't in the way.
 *
 * In-app list taps present this content in a dialog. Notification links continue
 * to use the route so they can open directly from outside the app.
 *
 * Every active occurrence of the reminder is confirmed independently (a reminder
 * with several times of day can have more than one pending at once), mirroring the
 * attention cards on the main list.
 *
 * The schedule is a quiet line beneath the title. Active firings follow the body,
 * so a notification tap brings the item and its actions into view together.
 */
import { useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Chip from '@mui/joy/Chip'
import SnoozeIcon from '@mui/icons-material/Snooze'
import EditIcon from '@mui/icons-material/Edit'
import ShareIcon from '@mui/icons-material/Share'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { formatMedications, reminderBodyText, todoItems } from '@persistent/shared'
import {
  useAddTodoItem,
  useCheckReminderItem,
  useReminders,
  useRenameTodoItem,
  useRemoveTodoItem,
  useReorderTodoItems,
  useSetHideCheckedItems,
  useUpdateReminderContent
} from '../data/reminders.js'
import {
  useActiveOccurrences,
  useAckOccurrence,
  useSnoozeOccurrence,
  useSilenceOccurrence,
  useCheckOccurrenceItem
} from '../data/occurrences.js'
import { reminderScheduleLine } from '../lib/scheduleSummary.js'
import { formatWhen } from '../lib/datetime.js'
import { reminderNextFire } from '../lib/schedule-preview.js'

import { useSettings } from '../settings/useSettings.js'
import { TypeIcon } from '../components/ReminderIcons.js'
import { FiringStatusChip } from '../components/FiringStatusChip.js'
import { firingTone } from '../lib/firingTone.js'
import { compareFirings } from '../lib/firingOrder.js'
import { OccurrenceActions } from '../components/OccurrenceActions.js'
import { TodoChecklist } from '../components/TodoChecklist.js'
import { SnoozeDialog } from '../components/SnoozeDialog.js'
import { ReminderSharing } from '../components/ReminderSharing.js'
import { ShareCountChip } from '../components/ShareCountChip.js'
import { PullToRefresh } from '../components/PullToRefresh.js'
import { InlineReminderText } from '../components/InlineReminderText.js'
import { useReceivedShares } from '../data/shares.js'
import { SharedReminderPage } from './SharedReminderPage.js'

export function ReminderDetailPage({ reminderId, onClose, onEdit }: {
  reminderId?: string
  onClose?: () => void
  onEdit?: () => void
} = {}) {
  const { id: routeId } = useParams()
  const id = reminderId ?? routeId
  const reminders = useReminders()
  const received = useReceivedShares()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const silence = useSilenceOccurrence()
  const checkItem = useCheckOccurrenceItem()
  const checkNoteItem = useCheckReminderItem()
  const addItem = useAddTodoItem()
  const reorderItems = useReorderTodoItems()
  const renameItem = useRenameTodoItem()
  const removeItem = useRemoveTodoItem()
  const hideChecked = useSetHideCheckedItems()
  const updateContent = useUpdateReminderContent()
  const { timeFormat } = useSettings()
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const reminder = reminders.data?.find((r) => r.id === id)
  const shared = received.data?.some((item) => item.id === id)

  if (!reminder && shared) return <SharedReminderPage reminderId={id} onClose={onClose} onEdit={onEdit} />

  // The reminder may still be loading (deep link from a notification) or gone.
  if (!reminder) {
    return (
      <Stack spacing={2}>
        {reminders.isLoading || received.isLoading ? (
          <Typography level="body-sm">Loading…</Typography>
        ) : (
          <>
            <Typography level="body-sm">Reminder not found.</Typography>
            <Button component={RouterLink} to="/" variant="outlined" sx={{ alignSelf: 'flex-start' }}>
              Back to reminders
            </Button>
          </>
        )}
      </Stack>
    )
  }

  // The checklist is rendered as real checkboxes per firing below, so the header
  // body drops the bulleted copy reminderBodyText builds for notifications. The
  // editor saves no details on a checklist, so this is normally empty.
  const items = reminder.type === 'TODO' ? todoItems(reminder.typeData) : []
  const canEditNoteBody = Boolean(onClose && reminder.schedule.kind === 'never' && reminder.type !== 'TODO')
  let body = items.length > 0 ? (reminder.details ?? '') : reminderBodyText(reminder)
  if (canEditNoteBody) {
    body = reminder.type === 'MEDICATION' ? formatMedications(reminder.typeData) : ''
  }
  const next = reminderNextFire(reminder)
  // Each pending occurrence gets its own action block, ordered as on the main
  // list — escalations first, then most recently fired (`lib/firingOrder.ts`).
  const occurrences = (active.data ?? []).filter((o) => o.reminderId === reminder.id).sort(compareFirings)

  const content = (
    <>
      <Stack spacing={2}>
        {!onClose && <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Button component={RouterLink} to="/" variant="plain" color="neutral" size="sm" startDecorator={<ArrowBackIcon />}>
            Back
          </Button>
          <Stack direction="row" spacing={0.5}>
            <Button
              variant="plain"
              size="sm"
              startDecorator={<ShareIcon />}
              endDecorator={reminder.shareCount + reminder.invitationCount > 0
                ? <ShareCountChip count={reminder.shareCount + reminder.invitationCount} />
                : undefined}
              onClick={() => setShareOpen(true)}
            >
              Share
            </Button>
            <Button
              component={onEdit ? 'button' : RouterLink}
              to={onEdit ? undefined : `/reminders/${reminder.id}/edit`}
              onClick={onEdit}
              variant="outlined"
              size="sm"
              startDecorator={<EditIcon />}
            >
              Edit
            </Button>
          </Stack>
        </Stack>}

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <TypeIcon type={reminder.type} />
            {onClose ? (
              <InlineReminderText
                kind="title"
                text={reminder.title}
                onSave={(title) => updateContent.mutate({ id: reminder.id, arg: { title } })}
              />
            ) : (
              <Typography level="title-lg" sx={{ minWidth: 0 }}>
                {reminder.title}
              </Typography>
            )}
            {!reminder.active && (
              <Chip size="sm" color="neutral" variant="outlined">
                paused
              </Chip>
            )}
          </Stack>
          {reminder.schedule.kind !== 'never' && (
            <Typography level="body-xs" sx={{ mt: 0.5, color: 'text.tertiary' }}>
              {reminderScheduleLine(reminder, timeFormat)}
              {next && reminder.schedule.kind !== 'once' ? ` · Next: ${formatWhen(next, timeFormat)}` : ''}
            </Typography>
          )}
          {body && (
            // pre-wrap: details are authored in a multi-line textarea, so the line
            // breaks the user typed are part of the content and must survive here.
            <Typography level="body-sm" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
              {body}
            </Typography>
          )}
          {canEditNoteBody && (
            <Box sx={{ mt: 0.5 }}>
              <InlineReminderText
                kind="body"
                text={reminder.details ?? ''}
                onSave={(details) => updateContent.mutate({ id: reminder.id, arg: { details: details || null } })}
              />
            </Box>
          )}
        </Box>

        {occurrences.length > 0 && (
          <Stack spacing={1.5}>
            {occurrences.map((occurrence) => {
              // Same treatment as the list card, from the same helper: only an
              // escalation shouts, and "Due" is used only where it's honest.
              const { orphaned, color, variant, doneLabel } = firingTone(reminder, occurrence)
              return (
                <Card key={occurrence.id} color={color} variant={variant} size="sm">
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
                      <Typography level="body-sm">{formatWhen(occurrence.scheduledFor, timeFormat)}</Typography>
                      <FiringStatusChip reminder={reminder} occurrence={occurrence} />
                    </Stack>
                    {occurrence.status === 'SNOOZED' && occurrence.snoozedUntil && (
                      <Typography
                        level="body-xs"
                        color="primary"
                        startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}
                      >
                        Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat)}
                      </Typography>
                    )}
                  </Box>
                  {orphaned && (
                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                      Notified you before this reminder was rescheduled. Clearing it won't affect the new schedule.
                    </Typography>
                  )}
                  {reminder.type === 'TODO' && (
                    <Box>
                      <TodoChecklist
                        items={items}
                        checkedItemIds={occurrence.checkedItemIds}
                        onToggle={(itemId, checked) =>
                          checkItem.mutate({ id: occurrence.id, arg: { itemId, checked } })
                        }
                        // Items are per reminder, so adding one from any of these
                        // cards adds it to the list every card is drawing.
                        onAddItem={(item) => addItem.mutate({ id: reminder.id, arg: item })}
                        onReorder={(itemIds) => reorderItems.mutate({ id: reminder.id, arg: { itemIds } })}
                        onRenameItem={(itemId, text) => renameItem.mutate({ id: reminder.id, itemId, arg: { text } })}
                        onRemoveItem={(itemId) => removeItem.mutate({ id: reminder.id, itemId })}
                        // Ticks are per firing, the collapse is per reminder — so
                        // every card here hides and shows together, and agrees with
                        // the same list on Current.
                        hideChecked={reminder.hideCheckedItems}
                        onHideCheckedChange={(hidden) => hideChecked.mutate({ id: reminder.id, arg: { hidden } })}
                      />
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <OccurrenceActions
                      occurrence={occurrence}
                      doneLabel={doneLabel}
                      onDone={() => ack.mutate({ id: occurrence.id, arg: undefined })}
                      doneLoading={ack.isPending}
                      onSnooze={() => setSnoozeFor(occurrence.id)}
                      onSilence={() => silence.mutate({ id: occurrence.id, arg: undefined })}
                      silenceLoading={silence.isPending}
                    />
                  </Box>
                </Card>
              )
            })}
          </Stack>
        )}

        {/* A kept note owns its own ticks. A scheduled reminder with no live
            firing only shows the checklist definition. */}
        {reminder.type === 'TODO' && occurrences.length === 0 && (
          <Card
            variant="plain"
            sx={{ p: 0, bgcolor: 'transparent', boxShadow: 'none' }}
          >
            <Typography level="title-sm">Checklist</Typography>
            {reminder.schedule.kind === 'never' ? (
              <TodoChecklist
                items={items}
                checkedItemIds={reminder.checkedItemIds}
                confirmable={false}
                onToggle={(itemId, checked) => checkNoteItem.mutate({
                  id: reminder.id,
                  arg: { itemId, checked }
                })}
                onAddItem={(item) => addItem.mutate({ id: reminder.id, arg: item })}
                onRenameItem={(itemId, text) => renameItem.mutate({ id: reminder.id, itemId, arg: { text } })}
                onRemoveItem={(itemId) => removeItem.mutate({ id: reminder.id, itemId })}
                onReorder={(itemIds) => reorderItems.mutate({ id: reminder.id, arg: { itemIds } })}
                hideChecked={reminder.hideCheckedItems}
                onHideCheckedChange={(hidden) => hideChecked.mutate({ id: reminder.id, arg: { hidden } })}
              />
            ) : (
              <TodoChecklist
                items={items}
                checkedItemIds={[]}
                confirmable={false}
                onAddItem={(item) => addItem.mutate({ id: reminder.id, arg: item })}
                onRenameItem={(itemId, text) => renameItem.mutate({ id: reminder.id, itemId, arg: { text } })}
                onRemoveItem={(itemId) => removeItem.mutate({ id: reminder.id, itemId })}
                onReorder={(itemIds) => reorderItems.mutate({ id: reminder.id, arg: { itemIds } })}
              />
            )}
            {reminder.schedule.kind !== 'never' && (
              <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                Ticked off each time this reminder notifies you.
              </Typography>
            )}
          </Card>
        )}

      </Stack>

      <SnoozeDialog
        open={snoozeFor !== null}
        busy={snooze.isPending}
        onClose={() => setSnoozeFor(null)}
        onSnooze={(minutes) => {
          if (snoozeFor) snooze.mutate({ id: snoozeFor, arg: minutes })
          setSnoozeFor(null)
        }}
      />
      <ReminderSharing open={shareOpen} onClose={() => setShareOpen(false)} reminderId={reminder.id} />
    </>
  )

  return onClose ? content : (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      {content}
    </PullToRefresh>
  )
}
