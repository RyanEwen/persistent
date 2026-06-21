/**
 * On-launch update prompt for the native app. Checks GitHub once on mount and,
 * if a newer release exists and the user hasn't already dismissed that version,
 * shows a dialog with the release notes and an Update / Later choice. Dismissing
 * (or updating) records the version so the prompt doesn't nag again. The web/PWA
 * updates itself via the service worker, so this only acts on the native app.
 */
import { useEffect, useState } from 'react'
import Modal from '@mui/joy/Modal'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogTitle from '@mui/joy/DialogTitle'
import DialogContent from '@mui/joy/DialogContent'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import { isNative } from './alarmBridge.js'
import { useUpdate, type ReleaseInfo } from './useUpdate.js'

const LAST_SEEN_KEY = 'persistent-last-seen-version'

/** Strip leading markdown heading markers so notes read cleanly in the dialog. */
function cleanNotes(notes: string): string {
  return notes.replace(/^#+\s*/gm, '').trim()
}

export function UpdateCheck() {
  const { check, start, install } = useUpdate()
  const [prompt, setPrompt] = useState<ReleaseInfo | null>(null)

  useEffect(() => {
    if (!isNative()) return
    let cancelled = false
    check().then((rel) => {
      if (cancelled || !rel) return
      if (localStorage.getItem(LAST_SEEN_KEY) === rel.version) return
      setPrompt(rel)
    })
    return () => {
      cancelled = true
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
    <Modal open onClose={dismiss}>
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
    </Modal>
  )
}
