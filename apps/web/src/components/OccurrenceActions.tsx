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
  doneLabel = 'Done'
}: {
  occurrence: Occurrence
  onDone: () => void
  doneLoading: boolean
  onSnooze: () => void
  onSilence: () => void
  silenceLoading: boolean
  /**
   * Verb for the terminal action. 'Clear' on an occurrence the reminder's schedule
   * no longer covers, where "Done" would claim the user completed something the
   * reminder has already moved on from. Same acknowledge either way.
   */
  doneLabel?: 'Done' | 'Clear'
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    // Fill the phone row, but keep actions compact beside the metadata on wider screens.
    // Confirmation keeps the same row and never completes anything on the first tap.
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}>
      <Stack direction="row" spacing={1} alignItems="stretch">
        {confirming ? (
          <>
            <Button variant="outlined" color="neutral" sx={{ flex: { xs: 1, sm: '0 0 auto' }, minHeight: 44 }} disabled={doneLoading} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button color="success" sx={{ flex: { xs: 1, sm: '0 0 auto' }, minHeight: 44 }} loading={doneLoading} onClick={onDone}>
              {doneLabel === 'Clear' ? 'Confirm clear' : 'Confirm done'}
            </Button>
          </>
        ) : (
          <>
            <IconButton
              variant="outlined"
              color="neutral"
              aria-label={`Snooze ${occurrence.reminder.title}`}
              title="Snooze"
              onClick={onSnooze}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <SnoozeIcon />
            </IconButton>
            <Button color="success" sx={{ flex: { xs: 1, sm: '0 0 auto' }, minHeight: 44 }} onClick={() => setConfirming(true)}>
              {doneLabel}
            </Button>
          </>
        )}
      </Stack>
      {/* Keep the secondary action below on phones and before Snooze/Done on wider screens. */}
      {!confirming && occurrence.status === 'ESCALATED' && (
        <Button variant="outlined" color="warning" loading={silenceLoading} onClick={onSilence} sx={{ minHeight: 44, order: { sm: -1 } }}>
          De-escalate
        </Button>
      )}
    </Stack>
  )
}
