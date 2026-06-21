/**
 * "About" / updates card for the Settings page: shows the current version and,
 * on the native app, a manual "Check for updates" control that surfaces release
 * notes and downloads + installs a newer APK in-app. On the web it just reports
 * the version (the service worker handles web updates).
 */
import { useState } from 'react'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import { isNative } from './alarmBridge.js'
import { useUpdate } from './useUpdate.js'

export function UpdateSettings() {
  const { available, checking, checkedClean, checkFailed, install, check, start, currentVersion } = useUpdate()
  const [notesOpen, setNotesOpen] = useState(false)

  return (
    <Card variant="outlined">
      <Typography level="title-sm">About</Typography>
      <Typography level="body-sm">Version {currentVersion}</Typography>

      {!isNative() ? (
        <Typography level="body-xs">
          The web app updates itself automatically. Install the Android app for in-app updates.
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
