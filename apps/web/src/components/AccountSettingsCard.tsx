/** One account settings surface for identity, passkeys, sign-out, and deletion. */
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/joy/Card'
import Divider from '@mui/joy/Divider'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Link from '@mui/joy/Link'
import { useAuth } from '../auth/useAuth.js'
import { PasskeysSection } from './PasskeysSection.js'
import { DeleteAccountSection } from './DeleteAccountSection.js'

export function AccountSettingsCard() {
  const { user, logout } = useAuth()

  return (
    <Card variant="outlined">
      <Stack spacing={1.5}>
        <Typography level="title-sm">Account</Typography>
        <Typography level="body-sm">{user?.email}</Typography>
        <Typography level="body-xs">Time zone: {user?.timeZone}</Typography>
        <Link component={RouterLink} to="/settings/shared">Shared with me</Link>
        <Button
          variant="soft"
          color="danger"
          onClick={() => void logout()}
          sx={{ alignSelf: 'flex-start' }}
        >
          Sign out
        </Button>
        <Divider />
        <PasskeysSection />
        {/* Keep the irreversible action at the bottom, apart from everyday controls. */}
        <Divider />
        <DeleteAccountSection />
      </Stack>
    </Card>
  )
}
