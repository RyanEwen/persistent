/**
 * Nudges toward the native apps. The title-bar button is a web-only app chooser,
 * while one permanently dismissible banner adapts to its host: Android
 * promotes Windows, Windows promotes Android, and an ordinary browser presents
 * both. This keeps the cross-device story visible without advertising the app the
 * user is already running.
 */
import { useState } from 'react'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import Box from '@mui/joy/Box'
import IconButton from '@mui/joy/IconButton'
import Typography from '@mui/joy/Typography'
import AndroidIcon from '@mui/icons-material/Android'
import CloseIcon from '@mui/icons-material/Close'
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded'
import WindowRoundedIcon from '@mui/icons-material/WindowRounded'
import { isNative } from '../native/alarmBridge.js'
import { isDesktopHost } from '../native/desktopBridge.js'
import {
  APP_PROMO_DISMISSED_KEY,
  getNativeAppsPromotion,
  type NativeAppsPromoHost
} from './appPromotion.js'
import { NativeAppStoreButtons } from './NativeAppStoreButtons.js'
import { NativeAppsDialog } from './NativeAppsDialog.js'

/** Identify the surface so the banner does not promote the app already in use. */
function currentPromoHost(): NativeAppsPromoHost {
  if (isNative()) return 'android'
  if (isDesktopHost()) return 'windows'
  return 'web'
}

export function GetTheAppButton() {
  const [dialogOpen, setDialogOpen] = useState(false)
  if (isNative() || isDesktopHost()) return null
  return (
    <>
      <Button
        size="sm"
        variant="soft"
        color="primary"
        startDecorator={<DevicesRoundedIcon />}
        onClick={() => setDialogOpen(true)}
      >
        Get the app
      </Button>
      <NativeAppsDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}

export function NativeAppsPromoBanner() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(APP_PROMO_DISMISSED_KEY) === '1')
  if (hidden) return null

  const promotion = getNativeAppsPromotion(currentPromoHost())
  let icon = <DevicesRoundedIcon />

  if (!promotion.showAndroid) {
    icon = <WindowRoundedIcon />
  } else if (!promotion.showWindows) {
    icon = <AndroidIcon />
  }

  return (
    <Alert
      color="primary"
      variant="soft"
      startDecorator={icon}
      endDecorator={
        <IconButton
          variant="plain"
          color="neutral"
          size="sm"
          aria-label="Dismiss app notice"
          onClick={() => {
            localStorage.setItem(APP_PROMO_DISMISSED_KEY, '1')
            setHidden(true)
          }}
        >
          <CloseIcon />
        </IconButton>
      }
      sx={{ mb: 2, alignItems: 'flex-start' }}
    >
      <Box>
        <Typography level="title-sm">{promotion.title}</Typography>
        <Typography level="body-sm" sx={{ mt: 0.5 }}>
          {promotion.description}
        </Typography>
        <Box sx={{ mt: 1 }}>
          <NativeAppStoreButtons
            showAndroid={promotion.showAndroid}
            showWindows={promotion.showWindows}
          />
        </Box>
      </Box>
    </Alert>
  )
}
