/**
 * The reminder's own tones, overriding this device's for this one reminder.
 *
 * Only the tones the reminder can actually play are offered, because the tab above
 * already decided which those are: a soft reminder notifies and (if it has a nag
 * interval) nags, an alarm rings, and a soft reminder that escalates does both. A
 * row for a tone that can never sound is a setting the user can get wrong.
 *
 * Android only, like shade prominence. The web can't open a ringtone picker and
 * can't play a chosen tone, but it still shows what was picked and can hand a tone
 * back to the device setting — a choice made on a phone should not be invisible and
 * unremovable everywhere else.
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import type { ReminderSoundKind, SoundChoice } from '@persistent/shared'
import { SoundPickerRow } from '../../components/SoundPickerRow.js'
import { isNative, pickSound } from '../../native/alarmBridge.js'
import { useSettings } from '../../settings/useSettings.js'
import type { FormState } from './formState.js'

export function ReminderSoundsField({
  form,
  set
}: {
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}) {
  const { alarmSound, notificationSound, nagSound } = useSettings()

  function setSound(kind: ReminderSoundKind, choice: SoundChoice | null) {
    set('sounds', { ...form.sounds, [kind]: choice })
  }

  async function choose(kind: ReminderSoundKind) {
    // The nag is a notification-type tone, so it browses the notification bank.
    const picked = await pickSound(kind === 'alarm' ? 'alarm' : 'notification', form.sounds[kind]?.uri ?? '')
    if (picked) setSound(kind, picked)
  }

  // A soft reminder notifies; one with a nag interval also nags; anything that rings
  // — inherently or by escalating — has an alarm tone.
  const soft = form.persistence === 'PERSISTENT'
  const rings = form.persistence === 'ALARM' || (soft && form.escalate)

  function row(kind: ReminderSoundKind, label: string, deviceTone: SoundChoice, deviceFallback?: string) {
    const chosen = form.sounds[kind]
    return (
      <SoundPickerRow
        label={label}
        value={chosen ? chosen.title : `This device: ${deviceTone.uri ? deviceTone.title : (deviceFallback ?? deviceTone.title)}`}
        onChoose={isNative() ? () => void choose(kind) : undefined}
        onClear={chosen ? () => setSound(kind, null) : undefined}
      />
    )
  }

  return (
    <FormControl>
      <FormLabel>Sound</FormLabel>
      <Stack spacing={1.5} sx={{ width: '100%' }}>
        {soft && row('notification', 'Notification sound', notificationSound)}
        {soft && form.soundIntervalMinutes > 0 &&
          row('nag', 'Nag sound', nagSound, `same as notification (${notificationSound.title})`)}
        {rings && row('alarm', 'Alarm sound', alarmSound)}
        <Typography level="body-xs">
          {isNative()
            ? 'Android only: overrides this device’s sound for this reminder alone. A device that doesn’t have the tone falls back to its own.'
            : 'Android only. Tones are picked in the Android app; a device that doesn’t have the tone falls back to its own.'}
        </Typography>
      </Stack>
    </FormControl>
  )
}
