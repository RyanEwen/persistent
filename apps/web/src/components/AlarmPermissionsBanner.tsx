/**
 * Persistent warning for missing Android special-access permissions.
 *
 * These are the grants that decide whether a fired alarm can actually reach the
 * user, and every one of them fails *silently* — the app looks fine until an
 * alarm doesn't. So this banner is deliberately not dismissible: it stays until
 * the permission is granted, which is the only thing that should make it go away.
 *
 * It re-checks whenever the app is resumed, so returning from the system settings
 * screen updates it without a restart. No-op on the web and on Android versions
 * where a given grant isn't needed (the native side reports those as satisfied).
 */
import { useCallback, useEffect, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { PushNotifications } from '@capacitor/push-notifications'
import Alert from '@mui/joy/Alert'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { AlarmPlugin, isNative } from '../native/alarmBridge.js'

interface Gap {
  key: 'notifications' | 'overlay' | 'fullScreen' | 'exactAlarms'
  title: string
  /** What actually breaks — concrete, not "for the best experience". */
  consequence: string
  fix: () => Promise<unknown>
}

const GAPS: Gap[] = [
  {
    key: 'notifications',
    title: 'Turn on notifications',
    consequence: 'Alarms will sound with nothing on screen to identify or stop them.',
    fix: () => PushNotifications.requestPermissions()
  },
  {
    key: 'overlay',
    title: 'Allow display over other apps',
    consequence: "Alarms can't take over the screen while you're using the phone — they collapse into a banner.",
    fix: () => AlarmPlugin.requestOverlayPermission()
  },
  {
    key: 'fullScreen',
    title: 'Allow full-screen notifications',
    consequence: "Alarms won't cover the lock screen, so a ringing alarm may be missed.",
    fix: () => AlarmPlugin.ensureFullScreenIntent()
  },
  {
    key: 'exactAlarms',
    title: 'Allow exact alarms',
    consequence: 'Reminders may fire late, batched by the system instead of at the time you set.'
  ,
    fix: () => AlarmPlugin.canScheduleExactAlarms()
  }
]

export function AlarmPermissionsBanner() {
  const [missing, setMissing] = useState<Gap[]>([])

  const check = useCallback(async () => {
    if (!isNative()) return
    const ready = await AlarmPlugin.alarmReadiness().catch(() => null)
    if (!ready) return
    setMissing(GAPS.filter((gap) => !ready[gap.key]))
  }, [])

  useEffect(() => {
    void check()
    if (!isNative()) return
    // Re-check on resume: granting happens in system settings, so the app is
    // backgrounded when it changes.
    let handle: PluginListenerHandle | undefined
    App.addListener('resume', () => void check())
      .then((h) => {
        handle = h
      })
      .catch(() => {})
    return () => {
      handle?.remove()
    }
  }, [check])

  if (missing.length === 0) return null

  return (
    <Alert
      color="danger"
      variant="soft"
      startDecorator={<WarningAmberIcon />}
      sx={{ mb: 2, alignItems: 'flex-start' }}
    >
      <Box>
        <Typography level="title-sm">
          {missing.length === 1 ? 'Alarms are not fully set up' : `${missing.length} things are limiting your alarms`}
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {missing.map((gap) => (
            <Box key={gap.key}>
              <Typography level="body-sm">{gap.consequence}</Typography>
              <Button
                size="sm"
                color="danger"
                variant="solid"
                sx={{ mt: 0.5 }}
                onClick={() => {
                  void gap.fix().then(() => check())
                }}
              >
                {gap.title}
              </Button>
            </Box>
          ))}
        </Stack>
      </Box>
    </Alert>
  )
}
