/**
 * The Edit / De-escalate / Snooze / Done action row for an active occurrence, in that
 * order — Done rightmost, nearest the thumb. Done is a two-step confirm (arm "Confirm
 * done" / "Not yet") so a stray tap can't complete a nagging reminder by accident.
 * Shared by the attention card (main list) and the single-reminder detail view.
 * ("De-escalate" is the user-facing label for the silence action; it shows only on
 * escalations.)
 *
 * **Done is the only labelled control on the row.** It is the app's entire
 * guarantee, so it keeps its word while Edit and Snooze are icons: that is what
 * makes it the obvious thing to reach for, and it buys back the width a four-control
 * row costs on a phone. Both icons carry an `aria-label` and a `title`, so they are
 * named to a screen reader and on hover.
 *
 * Edit is quieter still (plain, not outlined) and leftmost, furthest from the thumb:
 * it acts on the *reminder* rather than the firing, and it only navigates.
 */
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import EditIcon from '@mui/icons-material/Edit'
import SnoozeIcon from '@mui/icons-material/Snooze'
import type { Occurrence } from '@persistent/shared'

export function OccurrenceActions({
  occurrence,
  onDone,
  doneLoading,
  onSnooze,
  onSilence,
  silenceLoading,
  editHref,
  size = 'md',
  doneLabel = 'Done'
}: {
  occurrence: Occurrence
  onDone: () => void
  doneLoading: boolean
  onSnooze: () => void
  onSilence: () => void
  silenceLoading: boolean
  /**
   * Where the icon-only Edit goes — the reminder's editor. Omitted on a surface
   * that already offers Edit of its own (the detail view has it in the header), so
   * one screen never shows two.
   */
  editHref?: string
  /** 'sm' on the list card, where the row shares width with the reminder text. */
  size?: 'sm' | 'md'
  /**
   * Verb for the terminal action. 'Clear' on an occurrence the reminder's schedule
   * no longer covers, where "Done" would claim the user completed something the
   * reminder has already moved on from. Same acknowledge either way.
   */
  doneLabel?: 'Done' | 'Clear'
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    // Right-anchored, with Done/Confirm done always the rightmost (thumb-nearest)
    // button and the secondary actions trailing off to its left.
    <Stack
      direction="row"
      spacing={1}
      flexWrap="wrap"
      useFlexGap
      alignItems="center"
      justifyContent="flex-end"
    >
      {confirming ? (
        <>
          <Button size={size} variant="outlined" color="neutral" disabled={doneLoading} onClick={() => setConfirming(false)}>
            Not yet
          </Button>
          <Button size={size} color="success" loading={doneLoading} onClick={onDone}>
            {doneLabel === 'Clear' ? 'Confirm clear' : 'Confirm done'}
          </Button>
        </>
      ) : (
        <>
          {/* Absent from the confirm step above on purpose: once Done is armed the
              row is a yes/no question, and a way out of the screen is not an answer. */}
          {editHref && (
            <IconButton
              component={RouterLink}
              to={editHref}
              size={size}
              variant="plain"
              color="neutral"
              // Named by reminder, not just "Edit": Current lists one card per
              // firing, so a screen reader otherwise reads a column of identical
              // buttons. The tooltip stays short, since the card is right there.
              aria-label={`Edit ${occurrence.reminder.title}`}
              title="Edit reminder"
            >
              <EditIcon />
            </IconButton>
          )}
          {/* De-escalate keeps its label: it is rare, it is not the obvious meaning of
              any icon, and it only ever appears on an alarm the user wants to
              understand before touching. */}
          {occurrence.status === 'ESCALATED' && (
            <Button size={size} variant="outlined" color="warning" loading={silenceLoading} onClick={onSilence}>
              De-escalate
            </Button>
          )}
          <IconButton
            size={size}
            variant="outlined"
            color="neutral"
            aria-label={`Snooze ${occurrence.reminder.title}`}
            title="Snooze"
            onClick={onSnooze}
          >
            <SnoozeIcon />
          </IconButton>
          <Button size={size} color="success" onClick={() => setConfirming(true)}>
            {doneLabel}
          </Button>
        </>
      )}
    </Stack>
  )
}
