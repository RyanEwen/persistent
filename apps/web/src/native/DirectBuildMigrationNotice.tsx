/** Show the retired direct-build migration notice once per installation, keeping Settings guidance available. */
import { useState } from 'react'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogTitle from '@mui/joy/DialogTitle'
import DialogContent from '@mui/joy/DialogContent'
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import { hasNativeUpdater } from './alarmBridge.js'
import { BackAwareModal } from '../components/BackAwareModal.js'
import { DirectBuildNotice } from './DirectBuildNotice.js'

const NOTICE_SEEN_KEY = 'persistent-play-migration-notice-seen'

export function DirectBuildMigrationNotice() {
  const [open, setOpen] = useState(() => {
    if (!hasNativeUpdater()) return false
    try {
      return localStorage.getItem(NOTICE_SEEN_KEY) !== '1'
    } catch {
      return true
    }
  })

  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(NOTICE_SEEN_KEY, '1')
    } catch {
      // Storage may be unavailable; dismiss for this session without blocking the app.
    }
  }

  if (!open) return null
  return (
    <BackAwareModal open onClose={dismiss}>
      <ModalDialog>
        <DialogTitle>A change to Android downloads</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <DirectBuildNotice />
          </Stack>
        </DialogContent>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button variant="plain" color="neutral" onClick={dismiss}>Later</Button>
        </Stack>
      </ModalDialog>
    </BackAwareModal>
  )
}
