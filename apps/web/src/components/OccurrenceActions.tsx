/**
 * The De-escalate / Snooze / Done action row for an active occurrence. Done is a two-step confirm (arm "Confirm
 * done" / "Not yet") so a stray tap can't complete a nagging reminder by accident.
 * Shown in the reminder reading view, with the full reminder at hand.
 * ("De-escalate" is the user-facing label for the silence action; it shows only on
 * escalations.)
 *
 * Done keeps its visible label while Snooze uses an icon with an accessible name.
 * Editing the reminder lives in the reading dialog footer.
 */
import { useState } from 'react'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import SnoozeIcon from '@mui/icons-material/Snooze'
import type { Occurrence } from '@persistent/shared'

export function OccurrenceActions({
  occurrence,
  onDone,
  doneLoading,
  onSnooze,
  onSilence,
  silenceLoading,
  size = 'md',
  doneLabel = 'Done'
}: {
  occurrence: Occurrence
  onDone: () => void
  doneLoading: boolean
  onSnooze: () => void
  onSilence: () => void
  silenceLoading: boolean
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
