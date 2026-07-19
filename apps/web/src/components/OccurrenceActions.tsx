/**
 * The Done / Snooze / De-escalate action row for an active occurrence. Done is a
 * two-step confirm (arm "Confirm done" / "Not yet") so a stray tap can't complete
 * a nagging reminder by accident. Shared by the attention card (main list) and the
 * single-reminder detail view. ("De-escalate" is the user-facing label for the
 * silence action; it shows only on escalations.)
 */
import { useState } from 'react'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
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
          {occurrence.status === 'ESCALATED' && (
            <Button size={size} variant="outlined" color="warning" loading={silenceLoading} onClick={onSilence}>
              De-escalate
            </Button>
          )}
          <Button size={size} variant="outlined" color="neutral" onClick={onSnooze}>
            Snooze
          </Button>
          <Button size={size} color="success" onClick={() => setConfirming(true)}>
            {doneLabel}
          </Button>
        </>
      )}
    </Stack>
  )
}
