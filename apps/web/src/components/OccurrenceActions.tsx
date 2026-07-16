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
  silenceLoading
}: {
  occurrence: Occurrence
  onDone: () => void
  doneLoading: boolean
  onSnooze: () => void
  onSilence: () => void
  silenceLoading: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
      {confirming ? (
        <>
          <Button color="success" loading={doneLoading} onClick={onDone}>
            Confirm done
          </Button>
          <Button variant="outlined" color="neutral" disabled={doneLoading} onClick={() => setConfirming(false)}>
            Not yet
          </Button>
        </>
      ) : (
        <>
          <Button color="success" onClick={() => setConfirming(true)}>
            Done
          </Button>
          <Button variant="outlined" color="neutral" onClick={onSnooze}>
            Snooze
          </Button>
          {occurrence.status === 'ESCALATED' && (
            <Button variant="outlined" color="warning" loading={silenceLoading} onClick={onSilence}>
              De-escalate
            </Button>
          )}
        </>
      )}
    </Stack>
  )
}
