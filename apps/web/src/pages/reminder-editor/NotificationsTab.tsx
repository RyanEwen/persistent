/**
 * Notifications tab: how hard the reminder nags (notification vs alarm), the
 * re-sound interval, and where it sits in the Android shade. All of it describes a
 * firing, so a note — which never has one — gets an explanation instead.
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import { persistenceLevels, shadeProminenceLevels, type PersistenceLevel, type ShadeProminence } from '@persistent/shared'
import { DurationField } from '../../components/DurationField.js'
import type { FormState } from './formState.js'

const PERSISTENCE_LABELS: Record<PersistenceLevel, string> = {
  PERSISTENT: 'Notification',
  ALARM: 'Alarm'
}

const SHADE_PROMINENCE_LABELS: Record<ShadeProminence, string> = {
  INHERIT: 'Use default',
  NORMAL: 'Normal',
  MINIMIZED: 'Minimized'
}

export function NotificationsTab({
  form,
  set
}: {
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}) {
  if (form.when === 'never') {
    return (
      <Alert color="neutral" variant="soft">
        This is a note — it never notifies you, so there is nothing here to set. Give it a time on the Schedule tab
        to use these settings.
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      <FormControl>
        <FormLabel>How it notifies</FormLabel>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {persistenceLevels.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={form.persistence === p ? 'solid' : 'outlined'}
              onClick={() => set('persistence', p)}
            >
              {PERSISTENCE_LABELS[p]}
            </Button>
          ))}
        </Stack>
        <Typography level="body-xs" sx={{ mt: 0.5 }}>
          {form.persistence === 'ALARM'
            ? 'Rings continuously until you tap Done.'
            : 'A notification that stays until done. Choose how often it re-sounds to nag you.'}
        </Typography>
      </FormControl>

      {form.persistence === 'PERSISTENT' && (
        <FormControl>
          <FormLabel>Nag interval</FormLabel>
          <DurationField
            value={form.soundIntervalMinutes}
            onChange={(m) => set('soundIntervalMinutes', m)}
            extra={{ label: 'Once', value: 0 }}
          />
        </FormControl>
      )}

      <FormControl>
        <FormLabel>Shade prominence</FormLabel>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {shadeProminenceLevels.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={form.shadeProminence === p ? 'solid' : 'outlined'}
              onClick={() => set('shadeProminence', p)}
            >
              {SHADE_PROMINENCE_LABELS[p]}
            </Button>
          ))}
        </Stack>
        <Typography level="body-xs" sx={{ mt: 0.5 }}>
          {form.shadeProminence === 'MINIMIZED'
            ? 'Android only: tucks this reminder into the collapsed section at the bottom of the notification shade, with no pop-up banner. Visual only — it does not change the sound.'
            : form.shadeProminence === 'NORMAL'
              ? 'Android only: shows in the main notification shade and may pop up a banner. Visual only — it does not change the sound.'
              : 'Android only: follows your device default (Settings). Controls where the notification sits in the shade — not the sound.'}
        </Typography>
      </FormControl>
    </Stack>
  )
}
