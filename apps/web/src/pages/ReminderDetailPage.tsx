/**
 * Single-reminder detail: a focused, mostly read-only view of one reminder with
 * its active occurrences' Done / Snooze / De-escalate actions. This is where a
 * **notification tap** lands, and where History links — editing is one step away,
 * behind the Edit button, so the common case (confirm / snooze a nag) is front and
 * center and the large tabbed form isn't in the way.
 *
 * In-app list taps deliberately skip it and open the editor directly: there the
 * user already has the reminder in front of them, so this view is a stop on the
 * way to the only thing they came to do. That is also why the editor's parent is
 * the list rather than this page (`native/useNativeBack.ts`) — Back must not
 * strand them on a screen they never passed through.
 *
 * Every active occurrence of the reminder is confirmed independently (a reminder
 * with several times of day can have more than one pending at once), mirroring the
 * attention cards on the main list.
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { reminderBodyText, todoItems } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import {
  useActiveOccurrences,
  useAckOccurrence,
  useSnoozeOccurrence,
  useSilenceOccurrence,
  useCheckOccurrenceItem
} from '../data/occurrences.js'
import { scheduleSummary } from '../lib/scheduleSummary.js'
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
import { PullToRefresh } from '../components/PullToRefresh.js'

export function ReminderDetailPage() {
  const { id } = useParams()
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const silence = useSilenceOccurrence()
  const checkItem = useCheckOccurrenceItem()
  const { timeFormat } = useSettings()
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)

  const reminder = reminders.data?.find((r) => r.id === id)

  // The reminder may still be loading (deep link from a notification) or gone.
  if (!reminder) {
    return (
      <Stack spacing={2}>
        {reminders.isLoading ? (
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
  const body = items.length > 0 ? (reminder.details ?? '') : reminderBodyText(reminder)
  const next = reminderNextFire(reminder)
  // Each pending occurrence gets its own action block, ordered as on the main
  // list — escalations first, then most recently fired (`lib/firingOrder.ts`).
  const occurrences = (active.data ?? []).filter((o) => o.reminderId === reminder.id).sort(compareFirings)

  return (
    <PullToRefresh onRefresh={() => Promise.all([reminders.refetch(), active.refetch()])}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Button
            component={RouterLink}
            to="/"
            variant="plain"
            color="neutral"
            size="sm"
            startDecorator={<ArrowBackIcon />}
          >
            Back
          </Button>
          <Button
            component={RouterLink}
            to={`/reminders/${reminder.id}/edit`}
            variant="outlined"
            size="sm"
            startDecorator={<EditIcon />}
          >
            Edit
          </Button>
        </Stack>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <TypeIcon type={reminder.type} />
            <Typography level="title-lg" sx={{ minWidth: 0 }}>
              {reminder.title}
            </Typography>
            {!reminder.active && (
              <Chip size="sm" color="neutral" variant="outlined">
                paused
              </Chip>
            )}
          </Stack>
          {body && (
            // pre-wrap: details are authored in a multi-line textarea, so the line
            // breaks the user typed are part of the content and must survive here.
            <Typography level="body-sm" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
              {body}
            </Typography>
          )}
        </Box>

        <Card variant="soft">
          <Typography level="title-sm">Schedule</Typography>
          <Typography level="body-sm">{scheduleSummary(reminder.schedule, timeFormat)}</Typography>
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
            {/* "No upcoming fire" is the normal resting state of a one-shot that has
                already fired (every "remind me now" reminder lands here immediately),
                so it must not be reported as paused — only an inactive reminder is.
                A note is neither: it has no fire to be missing and pausing it would
                change nothing, so it says what that means instead. */}
            {reminder.schedule.kind === 'never'
              ? 'Nothing to confirm — kept under Notes on Current.'
              : !reminder.active
                ? 'Paused — no upcoming notification'
                : next
                  ? `Next: ${formatWhen(next, timeFormat)}`
                  : 'No upcoming notification'}
          </Typography>
        </Card>

        {/* With nothing due there is no firing to tick against — a checked set
            belongs to an occurrence — so the list shows as the definition it is. */}
        {items.length > 0 && occurrences.length === 0 && (
          <Card variant="soft">
            <Typography level="title-sm">Checklist</Typography>
            <Stack spacing={0.25}>
              {items.map((item) => (
                <Typography key={item.id} level="body-sm">
                  • {item.text}
                </Typography>
              ))}
            </Stack>
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
              {/* A checklist that never fires is a kept list, not a routine waiting
                  to come round — there is no firing for its ticks to belong to. */}
              {reminder.schedule.kind === 'never'
                ? 'A kept list — it never notifies you, so there is nothing to tick off.'
                : 'Ticked off each time this reminder notifies you.'}
            </Typography>
          </Card>
        )}

        {occurrences.length > 0 && (
          <Stack spacing={1.5}>
            <Typography level="title-sm">Needs attention</Typography>
            {occurrences.map((occurrence) => {
              // Same treatment as the list card, from the same helper: only an
              // escalation shouts, and "Due" is used only where it's honest.
              const { orphaned, color, variant, doneLabel } = firingTone(reminder, occurrence)
              return (
                <Card key={occurrence.id} color={color} variant={variant}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography level="body-sm">{formatWhen(occurrence.scheduledFor, timeFormat)}</Typography>
                      {occurrence.status === 'SNOOZED' && occurrence.snoozedUntil && (
                        <Typography
                          level="body-xs"
                          color="primary"
                          startDecorator={<SnoozeIcon sx={{ fontSize: 14 }} />}
                        >
                          Snoozed until {formatWhen(occurrence.snoozedUntil, timeFormat)}
                        </Typography>
                      )}
                      {orphaned && (
                        <Typography level="body-xs" sx={{ mt: 0.5, color: 'text.tertiary' }}>
                          Notified you before this reminder was rescheduled. Clearing it won't affect the new schedule.
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ flexShrink: 0 }}>
                      <FiringStatusChip reminder={reminder} occurrence={occurrence} />
                    </Box>
                  </Stack>
                  {items.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <TodoChecklist
                        items={items}
                        checkedItemIds={occurrence.checkedItemIds}
                        onToggle={(itemId, checked) =>
                          checkItem.mutate({ id: occurrence.id, arg: { itemId, checked } })
                        }
                      />
                    </Box>
                  )}
                  <Box sx={{ mt: 1 }}>
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
    </PullToRefresh>
  )
}
