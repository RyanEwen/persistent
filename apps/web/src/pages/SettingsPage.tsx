/**
 * Settings: enable browser notifications (Web Push), show account + time zone,
 * and sign out. The native Android app handles its own alarm permissions.
 */
import { useEffect, useState } from 'react'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import { extractErrorMessage } from '@persistent/shared'
import { useAuth } from '../auth/useAuth.js'
import { enablePush, disablePush, pushSupported, notificationPermission } from '../lib/push.js'
import { useSettings, type SoundChoice } from '../settings/useSettings.js'
import { APP_THEMES } from '../settings/themes.js'
import { formatDateTime } from '../lib/datetime.js'
import { AlarmPlugin, isNative } from '../native/alarmBridge.js'
import { UpdateSettings } from '../native/UpdateSettings.js'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const { timeFormat, setTimeFormat, themeId, setThemeId, alarmSound, notificationSound, setAlarmSound, setNotificationSound } =
    useSettings()

  async function chooseSound(type: 'alarm' | 'notification', current: SoundChoice, apply: (s: SoundChoice) => void) {
    try {
      const result = await AlarmPlugin.pickSound({ type, current: current.uri })
      if (result.cancelled) return
      apply({ uri: result.uri ?? '', title: result.title || 'Default' })
    } catch {
      /* picker unavailable */
    }
  }
  const [permission, setPermission] = useState(notificationPermission())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    if (!pushSupported()) return
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(Boolean(subscription)))
      .catch(() => {})
  }, [])

  async function onEnable() {
    setBusy(true)
    setError(null)
    try {
      const ok = await enablePush()
      setPermission(notificationPermission())
      setSubscribed(ok)
      if (!ok) setError('Notification permission was denied.')
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDisable() {
    setBusy(true)
    try {
      await disablePush()
      setSubscribed(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2}>
      <Typography level="title-lg">Settings</Typography>

      <Card variant="outlined">
        <Typography level="title-sm">Appearance</Typography>
        <FormControl>
          <FormLabel>Theme</FormLabel>
          <Select value={themeId} onChange={(_e, value) => value && setThemeId(value)}>
            {APP_THEMES.map((t) => (
              <Option key={t.id} value={t.id}>
                {t.name}
              </Option>
            ))}
          </Select>
        </FormControl>
        <Typography level="body-xs">Sets the background pattern across the app.</Typography>
      </Card>

      <Card variant="outlined">
        <Typography level="title-sm">Sounds</Typography>
        {isNative() ? (
          <Stack spacing={1.5}>
            <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <FormLabel>Notification sound</FormLabel>
                <Typography level="body-xs">{notificationSound.title}</Typography>
              </Box>
              <Button
                size="sm"
                variant="outlined"
                onClick={() => chooseSound('notification', notificationSound, setNotificationSound)}
              >
                Choose
              </Button>
            </FormControl>
            <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <FormLabel>Alarm sound</FormLabel>
                <Typography level="body-xs">{alarmSound.title}</Typography>
              </Box>
              <Button size="sm" variant="outlined" onClick={() => chooseSound('alarm', alarmSound, setAlarmSound)}>
                Choose
              </Button>
            </FormControl>
          </Stack>
        ) : (
          <Typography level="body-sm">Choosing sounds is available in the Android app.</Typography>
        )}
      </Card>

      {/* Web Push is best-effort and only relevant on the web; the native app
          uses on-device alarms, so this section is hidden there. */}
      {!isNative() && (
        <Card variant="outlined">
          <Typography level="title-sm">Browser notifications</Typography>
          <Typography level="body-sm">
            Best-effort on the web. For undismissable alarms with repeating sound, install the Android app.
          </Typography>
          {error && <Alert color="danger">{error}</Alert>}
          {!pushSupported() ? (
            <Alert color="warning">This browser doesn't support push notifications.</Alert>
          ) : subscribed ? (
            <Button variant="outlined" color="neutral" loading={busy} onClick={onDisable}>
              Disable notifications
            </Button>
          ) : (
            <Button loading={busy} onClick={onEnable} disabled={permission === 'denied'}>
              {permission === 'denied' ? 'Notifications blocked in browser' : 'Enable notifications'}
            </Button>
          )}
        </Card>
      )}

      <Card variant="outlined">
        <Typography level="title-sm">Date &amp; time</Typography>
        <FormControl>
          <FormLabel>Time format</FormLabel>
          <Select value={timeFormat} onChange={(_e, value) => value && setTimeFormat(value)}>
            <Option value="12h">12-hour (1:30 PM)</Option>
            <Option value="24h">24-hour (13:30)</Option>
          </Select>
        </FormControl>
        <Typography level="body-xs">Example: {formatDateTime(new Date(), timeFormat)}</Typography>
      </Card>

      <Card variant="outlined">
        <Typography level="title-sm">Account</Typography>
        <Typography level="body-sm">{user?.email}</Typography>
        <Typography level="body-xs">Time zone: {user?.timeZone}</Typography>
        <Button variant="soft" color="danger" onClick={() => void logout()} sx={{ mt: 1, alignSelf: 'flex-start' }}>
          Sign out
        </Button>
      </Card>

      <UpdateSettings />
    </Stack>
  )
}
