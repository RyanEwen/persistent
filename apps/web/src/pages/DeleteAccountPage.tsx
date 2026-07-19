/**
 * Public account-deletion instructions. Reachable at /delete-account WITHOUT
 * signing in — Google Play requires a deletion URL that resolves for a
 * logged-out visitor (they check it), so App.tsx routes this ahead of the auth
 * gate exactly like /privacy.
 *
 * The deletion itself lives in Settings (DeleteAccountCard -> DELETE /api/auth/me).
 * This page exists to explain the route and to give someone who cannot sign in a
 * way to ask. Keep it factually in sync with that endpoint.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Link from '@mui/joy/Link'
import Alert from '@mui/joy/Alert'

const CONTACT_EMAIL = 'contact@dynamic-solutions.ca'

export function DeleteAccountPage() {
  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', px: 2, py: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography level="h2">Delete your Persistent account</Typography>
          <Typography level="body-xs">Applies to the Persistent app (ca.persistent.app) and the web app.</Typography>
        </Box>

        <Alert color="warning" variant="soft">
          Deletion is immediate and permanent. There is no restore window and no grace period.
        </Alert>

        <Box>
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            Delete it yourself, in the app
          </Typography>
          <Stack spacing={1}>
            <Typography level="body-sm">
              1. Open Persistent (Android app or{' '}
              <Link href="https://persistent.dynamic-solutions.ca">the web app</Link>) and sign in.
            </Typography>
            <Typography level="body-sm">2. Go to <strong>Settings</strong>.</Typography>
            <Typography level="body-sm">
              3. Scroll to <strong>Delete account</strong> and tap it.
            </Typography>
            <Typography level="body-sm">
              4. Type your email address to confirm, then tap <strong>Delete permanently</strong>.
            </Typography>
          </Stack>
        </Box>

        <Box>
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            If you can't sign in
          </Typography>
          <Typography level="body-sm">
            Email <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link> from the address on the account and
            ask us to delete it. We action these manually, so allow a few days.
          </Typography>
        </Box>

        <Box>
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            What gets deleted
          </Typography>
          <Typography level="body-sm">
            Everything, straight away: your account and email address, every reminder and its settings, your full
            reminder history, your saved passkeys, your signed-in sessions, and every device registered to receive
            notifications. Nothing is retained afterwards, and no backup copy is kept for later restoration.
          </Typography>
        </Box>

        <Box>
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            Deleting individual reminders instead
          </Typography>
          <Typography level="body-sm">
            If you only want to remove some data, open a reminder and choose <strong>Delete reminder</strong>. That
            removes it and its history without touching the rest of your account.
          </Typography>
        </Box>

        <Typography level="body-sm">
          See also our <Link href="/privacy">privacy policy</Link>.
        </Typography>
      </Stack>
    </Box>
  )
}
