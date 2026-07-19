/**
 * Update prompt for the native app. Checks GitHub on mount and again whenever the
 * app is resumed (throttled to RESUME_THROTTLE_MS) — the app is often left
 * resident, so a cold-start-only check would rarely surface a new APK. If a newer
 * release exists and the user hasn't already dismissed that version, shows a
 * dialog with the release notes and an Update / Later choice. Dismissing (or
 * updating) records the version so the prompt doesn't nag again. The web/PWA
 * updates itself via the service worker, so this only acts on the native app.
 */
import { useEffect, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogTitle from '@mui/joy/DialogTitle'
import DialogContent from '@mui/joy/DialogContent'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import { hasNativeUpdater } from './alarmBridge.js'
import { useUpdate, type ReleaseInfo } from './useUpdate.js'
import { BackAwareModal } from '../components/BackAwareModal.js'

const LAST_SEEN_KEY = 'persistent-last-seen-version'
const LAST_CHECK_KEY = 'persistent-last-update-check'
/** A resumed (not cold-started) app re-checks at most this often. */
const RESUME_THROTTLE_MS = 3 * 60 * 60 * 1000

/** Strip leading markdown heading markers so notes read cleanly in the dialog. */
function cleanNotes(notes: string): string {
  return notes.replace(/^#+\s*/gm, '').trim()
}

export function UpdateCheck() {
  const { check, start, install } = useUpdate()
  const [prompt, setPrompt] = useState<ReleaseInfo | null>(null)

  useEffect(() => {
    // Play-flavor builds have no Update plugin — Play does the updating.
    if (!hasNativeUpdater()) return
    let cancelled = false
    let resumeHandle: PluginListenerHandle | undefined

    const runCheck = () => {
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
      void check().then((rel) => {
        if (cancelled || !rel) return
        if (localStorage.getItem(LAST_SEEN_KEY) === rel.version) return
        setPrompt(rel)
      })
    }

    // Cold start always checks; a resume re-checks only once the throttle window
    // has elapsed, so keeping the app resident still surfaces new APKs without
    // hitting the release endpoint on every brief foregrounding.
    const checkOnResume = () => {
      const last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0
      if (Date.now() - last < RESUME_THROTTLE_MS) return
      runCheck()
    }

    runCheck()
    void App.addListener('resume', checkOnResume).then((handle) => {
      if (cancelled) void handle.remove()
      else resumeHandle = handle
    })

    return () => {
      cancelled = true
      void resumeHandle?.remove()
    }
    // check is stable (useCallback); run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = () => {
    if (prompt) localStorage.setItem(LAST_SEEN_KEY, prompt.version)
    setPrompt(null)
  }

  if (!prompt) return null
  const notes = cleanNotes(prompt.notes)
  return (
    <BackAwareModal open onClose={dismiss}>
      <ModalDialog>
        <DialogTitle>Version {prompt.version} available</DialogTitle>
        <DialogContent>
          <Typography level="body-sm" sx={{ whiteSpace: 'pre-wrap' }}>
            {notes || 'A new version of Persistent is available.'}
          </Typography>
        </DialogContent>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button variant="plain" color="neutral" onClick={dismiss}>
            Later
          </Button>
          <Button loading={install === 'downloading'} onClick={() => start(prompt)}>
            Update
          </Button>
        </Stack>
      </ModalDialog>
    </BackAwareModal>
  )
}
