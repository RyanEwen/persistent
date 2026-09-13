/** Store chooser opened by the web title bar's "Get the app" action. */
import Button from '@mui/joy/Button'
import DialogActions from '@mui/joy/DialogActions'
import DialogContent from '@mui/joy/DialogContent'
import DialogTitle from '@mui/joy/DialogTitle'
import ModalDialog from '@mui/joy/ModalDialog'
import Typography from '@mui/joy/Typography'
import { BackAwareModal } from './BackAwareModal.js'
import { NativeAppStoreButtons } from './NativeAppStoreButtons.js'

export interface NativeAppsDialogProps {
  open: boolean
  onClose(): void
}

/** Present both native apps without treating either platform as the default. */
export function NativeAppsDialog({ open, onClose }: NativeAppsDialogProps) {
  return (
    <BackAwareModal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 'min(400px, calc(100vw - 32px))' }}>
        <DialogTitle>Get Persistent</DialogTitle>
        <DialogContent>
          <Typography level="body-sm">
            Android provides hard alarm guarantees. The Windows companion adds tray access, an upcoming widget, and
            persistent notifications with alarm audio while your PC is awake.
          </Typography>
          <NativeAppStoreButtons />
        </DialogContent>
        <DialogActions>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </ModalDialog>
    </BackAwareModal>
  )
}
