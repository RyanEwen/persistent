/**
 * Settings for appearance, native notifications, account access and sign-out.
 * Browser notifications are deliberately unsupported; Android and Windows each
 * render their own device-specific controls here.
 *
 * Every host adds its own cards here rather than putting them somewhere of its
 * own: Android's sounds and shade prominence, and the Windows tray app's
 * notifications, startup and window settings (`native/desktop-settings/`). One
 * Settings screen per product, whichever host is showing it.
 */
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Card from '@mui/joy/Card'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Link from '@mui/joy/Link'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import { useAuth } from '../auth/useAuth.js'
import { useSettings, type SoundChoice } from '../settings/useSettings.js'
import { doodleColorOptions, type DoodleColorId } from '../settings/doodleColors.js'
import { useAppTheme } from '../settings/useAppTheme.js'
import { THEME_OPTIONS } from '../settings/themes.js'
import { formatDateTime } from '../lib/datetime.js'
import { SectionHeading } from '../components/SectionHeading.js'
import { SoundPickerRow } from '../components/SoundPickerRow.js'
import { AlarmPlugin, isNative, pickSound } from '../native/alarmBridge.js'
import { mirrorSyncConfig } from '../native/nativeSync.js'
import { DesktopSettings } from '../native/desktop-settings/DesktopSettings.js'
import { UpdateSettings } from '../native/UpdateSettings.js'
import { PasskeysCard } from '../components/PasskeysCard.js'
import { DeleteAccountCard } from '../components/DeleteAccountCard.js'
import { NativeAppStoreButtons } from '../components/NativeAppStoreButtons.js'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const {
    timeFormat,
    setTimeFormat,
    themeId,
    setThemeId,
    doodles,
    setDoodles,
    doodleColor,
    setDoodleColor,
    alarmSound,
    notificationSound,
    nagSound,
    setAlarmSound,
    setNotificationSound,
    setNagSound,
    shadeProminence,
    setShadeProminence
  } = useSettings()

  const theme = useAppTheme()
  const doodleColors = doodleColorOptions(theme)
  const doodleBackgroundOptions = [
    ...doodleColors.slice(0, 1),
    { id: 'none' as const, name: 'No doodles', color: null },
    ...doodleColors.slice(1)
  ]

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
  return (
    <Stack spacing={1.5}>
      <SectionHeading
        title="Settings"
        subtitle="Appearance, sounds, notifications, and account"
      />

      {user?.isAdmin && (
        <Button component={RouterLink} to="/admin" variant="outlined">Administration</Button>
      )}

      <Card variant="outlined">
        <Typography level="title-sm">Appearance</Typography>
        <FormControl>
          <FormLabel>Theme</FormLabel>
          <Select value={themeId} onChange={(_e, value) => value && setThemeId(value)}>
            {THEME_OPTIONS.map((t) => (
              <Option key={t.id} value={t.id}>
                {t.name}
              </Option>
            ))}
          </Select>
        </FormControl>
        <Typography level="body-xs">Match system automatically follows your device's light or dark appearance.</Typography>
        <FormControl>
          <FormLabel>Doodle background</FormLabel>
          <Select<DoodleColorId | 'none'>
            value={doodles ? doodleColor : 'none'}
            onChange={(_event, value) => {
              if (!value) return

              if (value === 'none') {
                setDoodles(false)
              } else {
                setDoodleColor(value)
                setDoodles(true)
              }
            }}
          >
            {doodleBackgroundOptions.map((option) => (
              <Option key={option.id} value={option.id} sx={{ gap: 1 }}>
                {option.color && (
                  <Box
                    aria-hidden="true"
                    sx={{ width: 14, height: 14, flexShrink: 0, borderRadius: '50%', bgcolor: option.color, border: '1px solid', borderColor: 'neutral.outlinedBorder' }}
                  />
                )}
                {option.name}
              </Option>
            ))}
          </Select>
        </FormControl>
        <Typography level="body-xs">Choose the doodle line color. Light themes use pale colors; darker themes use dark colors.</Typography>
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

      {/* The Windows tray app's own settings. Renders nothing anywhere else. */}
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
        <Typography level="body-xs">Example: {formatDateTime(new Date(), timeFormat, user?.timeZone)}</Typography>
      </Card>

      <Card variant="outlined">
        <Typography level="title-sm">Account</Typography>
        <Typography level="body-sm">{user?.email}</Typography>
        <Typography level="body-xs">Time zone: {user?.timeZone}</Typography>
        <Link component={RouterLink} to="/settings/shared">
          Shared with me
        </Link>
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
        <Typography level="title-sm">Apps</Typography>
        <Typography level="body-sm">
          Get alarms that work offline on Android, or persistent alerts while your PC is awake with the Windows app.
        </Typography>
        <NativeAppStoreButtons />
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
