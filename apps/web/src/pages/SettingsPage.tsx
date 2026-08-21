/**
 * Settings: enable browser notifications (Web Push), show account + time zone,
 * and sign out. The native Android app handles its own alarm permissions.
 *
 * Every host adds its own cards here rather than putting them somewhere of its
 * own: Android's sounds and shade prominence, and the Windows tray app's
 * notifications, startup and window settings (`native/desktop-settings/`). One
 * Settings screen per product, whichever host is showing it.
 */
import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Link from '@mui/joy/Link'
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
import { SectionHeading } from '../components/SectionHeading.js'
import { SoundPickerRow } from '../components/SoundPickerRow.js'
import { AlarmPlugin, isNative, pickSound } from '../native/alarmBridge.js'
import { mirrorSyncConfig } from '../native/nativeSync.js'
import { hostSupportsPush } from '../native/desktopBridge.js'
import { DesktopSettings } from '../native/desktop-settings/DesktopSettings.js'
import { UpdateSettings } from '../native/UpdateSettings.js'
import { PasskeysCard } from '../components/PasskeysCard.js'
import { DeleteAccountCard } from '../components/DeleteAccountCard.js'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const {
    timeFormat,
    setTimeFormat,
    themeId,
    setThemeId,
    alarmSound,
    notificationSound,
    nagSound,
    setAlarmSound,
    setNotificationSound,
    setNagSound,
    shadeProminence,
    setShadeProminence
  } = useSettings()

  async function chooseSound(type: 'alarm' | 'notification', current: SoundChoice, apply: (s: SoundChoice) => void) {
    const picked = await pickSound(type, current.uri)
    if (!picked) return
    apply(picked)
    // Push it to native now rather than at the next resync, so a tone chosen and
    // immediately tested is the one that rings.
    void mirrorSyncConfig().catch(() => {})
  }

  function changeShadeProminence(value: 'NORMAL' | 'MINIMIZED') {
    setShadeProminence(value)
    // Update the native default + re-post any live notifications immediately.
    void AlarmPlugin.setDefaultShadeProminence({ minimized: value === 'MINIMIZED' }).catch(() => {})
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
    <Stack spacing={1.5}>
      <SectionHeading
        title="Settings"
        subtitle="Appearance, sounds and notifications on this device"
      />

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
            <SoundPickerRow
              label="Notification sound"
              value={notificationSound.title}
              onChoose={() => void chooseSound('notification', notificationSound, setNotificationSound)}
            />
            <SoundPickerRow
              label="Nag sound"
              value={nagSound.uri ? nagSound.title : `Same as notification (${notificationSound.title})`}
              onChoose={() => void chooseSound('notification', nagSound, setNagSound)}
            />
            <Typography level="body-xs">
              The notification sound plays the first time a reminder notifies you; the nag sound plays on each repeat after
              that, for reminders with a nag interval set. Alarms ring one continuous tone, so this doesn't apply
              to them.
            </Typography>
            <SoundPickerRow
              label="Alarm sound"
              value={alarmSound.title}
              onChoose={() => void chooseSound('alarm', alarmSound, setAlarmSound)}
            />
            <Typography level="body-xs">
              These are this device's tones. A single reminder can override them on its Notifications tab.
            </Typography>
          </Stack>
        ) : (
          <Typography level="body-sm">Choosing sounds is available in the Android app.</Typography>
        )}
      </Card>

      {isNative() && (
        <Card variant="outlined">
          <Typography level="title-sm">Notification shade</Typography>
          <FormControl>
            <FormLabel>Default prominence</FormLabel>
            <Select value={shadeProminence} onChange={(_e, value) => value && changeShadeProminence(value)}>
              <Option value="NORMAL">Normal</Option>
              <Option value="MINIMIZED">Minimized</Option>
            </Select>
          </FormControl>
          <Typography level="body-xs">
            Where reminders sit in the Android notification shade by default. Minimized tucks them into the
            collapsed section at the bottom with no pop-up banner. This is visual only — it doesn't change the
            sound, and a reminder can override it. Escalations always stay prominent.
          </Typography>
        </Card>
      )}

      {/* Web Push is best-effort and only relevant on the web; the native app uses
          on-device alarms, so this section is hidden there. It is hidden in the
          Windows tray app too — `hostSupportsPush()` says why the subscription can
          never work in a WebView2, and that host's own notification setting is the
          `DesktopSettings` card directly below. Without this the card showed and
          its button just failed. */}
      {!isNative() && hostSupportsPush() && (
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

      {/* The Windows tray app's own settings: two cards, the first sitting in the
          notification slot the card above leaves empty on that host. Renders
          nothing anywhere else. */}
      <DesktopSettings />

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

      <PasskeysCard />

      <Card variant="outlined">
        <Typography level="title-sm">Help</Typography>
        <Typography level="body-sm">
          New here, or want a refresher on how nagging, escalation, and Done/De-escalate/Snooze work?{' '}
          <Link component={RouterLink} to="/help">
            How Persistent works
          </Link>
        </Typography>
      </Card>

      <Card variant="outlined">
        <Typography level="title-sm">Privacy</Typography>
        <Typography level="body-sm">
          What Persistent stores and who it's shared with:{' '}
          <Link component={RouterLink} to="/privacy">
            Privacy policy
          </Link>
          {' · '}
          <Link component={RouterLink} to="/delete-account">
            Deleting your account
          </Link>
        </Typography>
      </Card>

      <UpdateSettings />

      <DeleteAccountCard />
    </Stack>
  )
}
