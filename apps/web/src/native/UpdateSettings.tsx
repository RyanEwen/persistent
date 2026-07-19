/**
 * "About" / updates card for the Settings page: shows the current version and,
 * on the sideloaded Android build, a manual "Check for updates" control that
 * surfaces release notes and installs a newer APK in-app.
 *
 * The manual control is gated on `hasNativeUpdater()`, not `isNative()`: the Play
 * flavor is also native but deliberately ships without the Update plugin, since
 * Play forbids an app it distributes from updating itself. Both flavors load this
 * same hosted bundle, so the distinction can only be made at runtime.
 */
import { useState } from 'react'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import { hasNativeUpdater } from './alarmBridge.js'
import { useUpdate } from './useUpdate.js'

export function UpdateSettings() {
  const { available, checking, checkedClean, checkFailed, install, check, start, currentVersion } = useUpdate()
  const [notesOpen, setNotesOpen] = useState(false)

  return (
    <Card variant="outlined">
      <Typography level="title-sm">About</Typography>
      <Typography level="body-sm">Version {currentVersion}</Typography>

      {/* Only the sideloaded `direct` flavor can install an APK. The Play build
          loads this same hosted bundle, so the check is at runtime, not build time. */}
      {!hasNativeUpdater() ? (
        <Typography level="body-xs">
          This app updates itself automatically — from Google Play on the Play build, and via the service worker on
          the web.
        </Typography>
      ) : (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {available ? (
            <>
              <Alert color="primary" variant="soft" sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
                <Typography level="title-sm">Version {available.version} is available</Typography>
                {available.notes && (
                  <Box>
                    <Typography
                      level="body-xs"
                      sx={
                        notesOpen
                          ? { whiteSpace: 'pre-wrap' }
                          : { whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                      }
                    >
                      {available.notes.replace(/^#+\s*/gm, '').trim()}
                    </Typography>
                    <Button variant="plain" size="sm" sx={{ alignSelf: 'flex-start', px: 0 }} onClick={() => setNotesOpen((v) => !v)}>
                      {notesOpen ? 'Show less' : 'Show more'}
                    </Button>
                  </Box>
                )}
              </Alert>
              <Button loading={install === 'downloading'} onClick={() => start(available)}>
                Download &amp; install
              </Button>
              {install === 'failed' && <Alert color="danger">Download failed. Try again.</Alert>}
            </>
          ) : (
            <>
              <Button variant="outlined" color="neutral" loading={checking} onClick={() => void check()}>
                Check for updates
              </Button>
              {checkedClean && (
                <Typography level="body-xs" color="success">
                  You're on the latest version.
                </Typography>
              )}
              {checkFailed && <Alert color="danger">Couldn't check for updates. Try again.</Alert>}
            </>
          )}
        </Stack>
      )}
    </Card>
  )
}
