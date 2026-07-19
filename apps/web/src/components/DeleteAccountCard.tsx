/**
 * Settings card for permanent account deletion.
 *
 * Deletion is irreversible and takes every reminder, occurrence, passkey, and
 * push subscription with it, so the dialog requires the user to type their own
 * email address before the button arms — the same "make it deliberate" stance
 * the Done confirm takes, for a much less reversible action. Google Play
 * requires an in-app deletion path; see apps/mobile/store/play-readiness.md.
 */
import { useState } from 'react'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Input from '@mui/joy/Input'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Alert from '@mui/joy/Alert'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogTitle from '@mui/joy/DialogTitle'
import DialogContent from '@mui/joy/DialogContent'
import { extractErrorMessage } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { useAuth } from '../auth/useAuth.js'
import { BackAwareModal } from './BackAwareModal.js'

export function DeleteAccountCard() {
  const { user, refreshAfterDeletion } = useAuth()
  const [open, setOpen] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = confirmEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase()

  function close() {
    if (busy) return
    setOpen(false)
    setConfirmEmail('')
    setError(null)
  }

  async function onDelete() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/auth/me', {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail: confirmEmail.trim().toLowerCase() })
      })
      // The session is gone server-side; drop local state so the app returns to
      // sign-in with no stale cached reminders left behind on this device.
      await refreshAfterDeletion()
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't delete your account."))
      setBusy(false)
    }
  }

  return (
    <Card variant="outlined">
      <Typography level="title-sm">Delete account</Typography>
      <Typography level="body-sm">
        Permanently deletes your account and every reminder, history entry, and passkey attached to it. This
        cannot be undone.
      </Typography>
      <Button
        variant="soft"
        color="danger"
        onClick={() => setOpen(true)}
        sx={{ mt: 1, alignSelf: 'flex-start' }}
      >
        Delete account
      </Button>

      <BackAwareModal open={open} onClose={close}>
        <ModalDialog variant="outlined" role="alertdialog" sx={{ maxWidth: 420 }}>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography level="body-sm">
                This deletes your reminders, your full history, your passkeys, and every device registered for
                notifications. It is immediate and cannot be undone.
              </Typography>
              {error && <Alert color="danger">{error}</Alert>}
              <FormControl>
                <FormLabel>Type {user?.email} to confirm</FormLabel>
                <Input
                  value={confirmEmail}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                  placeholder={user?.email}
                  autoComplete="off"
                  disabled={busy}
                />
              </FormControl>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button variant="plain" color="neutral" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button color="danger" onClick={() => void onDelete()} disabled={!matches} loading={busy}>
                  Delete permanently
                </Button>
              </Stack>
            </Stack>
          </DialogContent>
        </ModalDialog>
      </BackAwareModal>
    </Card>
  )
}
