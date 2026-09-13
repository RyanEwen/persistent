/**
 * Windows notification controls shown only inside the desktop host.
 *
 * The durations come from the host, not from `SNOOZE_PRESETS`: Windows caps a
 * toast's picker at five items, so offering the app's full seven here would let the
 * user pick one the notification can never start on. See `SnoozeChoiceOption`.
 */
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Switch from '@mui/joy/Switch'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import FormHelperText from '@mui/joy/FormHelperText'
import type { HostSettingsProps } from './types.js'

export function DesktopNotificationsCard({ settings, update }: HostSettingsProps) {
  return (
    <Card variant="outlined">
      <Typography level="title-sm">Windows notifications</Typography>
      <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <FormLabel>Persistent notifications on this PC</FormLabel>
        <Switch checked={settings.notifications} onChange={(e) => update({ notifications: e.target.checked })} />
      </FormControl>
      <Typography level="body-xs">
        Keeps each reminder visible and brings it back if dismissed. Alarm reminders loop the Windows alarm sound;
        escalations can be de-escalated without marking them done. This works while the PC is awake and Persistent is
        running, and catches up after reconnecting. It cannot wake a sleeping or shut-down PC, so Android remains the
        hard alarm guarantee.
      </Typography>
      {/* The duration only means anything while the notifications are on, so it
          follows the toggle rather than sitting there looking editable. */}
      {settings.notifications && (
        <FormControl>
          <FormLabel>Snooze starts on</FormLabel>
          <Select
            value={settings.snoozeMinutes}
            onChange={(_e, value) => value !== null && update({ snoozeMinutes: value })}
          >
            {settings.snoozeChoices.map((choice) => (
              <Option key={choice.minutes} value={choice.minutes}>
                {choice.label}
              </Option>
            ))}
          </Select>
          <FormHelperText>
            Which duration the notification's snooze picker starts on. Windows allows it five, so Snooze inside the
            app offers more.
          </FormHelperText>
        </FormControl>
      )}
    </Card>
  )
}
