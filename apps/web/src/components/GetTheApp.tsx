/**
 * Web-only nudges toward the native Android app (the primary experience, where
 * the hard alarm guarantees live). A compact title-bar button and a dismissible
 * banner; both link to the latest release APK. No-ops in the native app.
 *
 * The Windows tray host gets the banner but not the button. Its flyout is a
 * ~420px column, so a permanent fixture in the title bar costs real space there —
 * whereas the banner is dismissible and its message lands harder, not softer, on
 * that host: the desktop app deliberately provides no alarm, so "the Android app
 * is the one that actually nags you" is something a Windows user needs told.
 */
import { useEffect, useState } from 'react'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import IconButton from '@mui/joy/IconButton'
import Link from '@mui/joy/Link'
import Typography from '@mui/joy/Typography'
import AndroidIcon from '@mui/icons-material/Android'
import CloseIcon from '@mui/icons-material/Close'
import { isNative } from '../native/alarmBridge.js'
import { isDesktopHost } from '../native/desktopBridge.js'
import { fetchLatestRelease } from '../native/useUpdate.js'

const RELEASES_URL = 'https://github.com/RyanEwen/persistent/releases/latest'
const BANNER_DISMISSED_KEY = 'persistent-hide-app-banner'

function useApkUrl(): string {
  const [url, setUrl] = useState(RELEASES_URL)
  useEffect(() => {
    let cancelled = false
    fetchLatestRelease()
      .then((r) => {
        if (!cancelled && r?.apkUrl) setUrl(r.apkUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return url
}

export function GetTheAppButton() {
  const url = useApkUrl()
  if (isNative() || isDesktopHost()) return null
  return (
    <Button
      component="a"
      href={url}
      target="_blank"
      rel="noreferrer"
      size="sm"
      variant="soft"
      color="primary"
      startDecorator={<AndroidIcon />}
    >
      Get the app
    </Button>
  )
}

export function NativePromoBanner() {
  const url = useApkUrl()
  const [hidden, setHidden] = useState(() => localStorage.getItem(BANNER_DISMISSED_KEY) === '1')
  if (isNative() || hidden) return null
  return (
    <Alert
      color="primary"
      variant="soft"
      startDecorator={<AndroidIcon />}
      endDecorator={
        <IconButton
          variant="plain"
          color="neutral"
          size="sm"
          aria-label="Dismiss"
          onClick={() => {
            localStorage.setItem(BANNER_DISMISSED_KEY, '1')
            setHidden(true)
          }}
        >
          <CloseIcon />
        </IconButton>
      }
      sx={{ mb: 2 }}
    >
      <Typography level="body-sm">
        Install the <Link href={url} target="_blank" rel="noreferrer">Android app</Link> for reliable, undismissable
        alarms — the web is best-effort and the app is the way Persistent is meant to be used.
      </Typography>
    </Alert>
  )
}
