/**
 * Settings card to manage passkeys: list registered credentials, add a new one
 * (WebAuthn registration), and remove them. Passkeys let you sign in without an
 * email code. See docs/auth-architecture.md.
 */
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import Chip from '@mui/joy/Chip'
import Alert from '@mui/joy/Alert'
import Avatar from '@mui/joy/Avatar'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import KeyRoundedIcon from '@mui/icons-material/KeyRounded'
import CloudRoundedIcon from '@mui/icons-material/CloudRounded'
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded'
import PhoneIphoneRoundedIcon from '@mui/icons-material/PhoneIphoneRounded'
import UsbRoundedIcon from '@mui/icons-material/UsbRounded'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { extractErrorMessage, type PasskeyListResponse } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { formatDate } from '../lib/datetime.js'
import { passkeyRegister } from '../native/passkeyClient.js'
import { describePasskey, type PasskeyVisualKind } from '../lib/passkeyMetadata.js'
import { useToast } from './ToastProvider.js'

const PASSKEYS_KEY = ['passkeys'] as const

function KindIcon({ kind }: { kind: PasskeyVisualKind }) {
  switch (kind) {
    case 'synced':
      return <CloudRoundedIcon />
    case 'device':
      return <DevicesRoundedIcon />
    case 'phone':
      return <PhoneIphoneRoundedIcon />
    case 'security-key':
      return <UsbRoundedIcon />
    default:
      return <KeyRoundedIcon />
  }
}

export function PasskeysCard() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const passkeys = useQuery({
    queryKey: PASSKEYS_KEY,
    queryFn: () => apiFetch<PasskeyListResponse>('/api/auth/passkeys')
  })

  const add = useMutation({
    mutationFn: async () => {
      const begin = await apiFetch<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        '/api/auth/passkey/register/options',
        { method: 'POST' }
      )
      const registration = await passkeyRegister(begin.options)
      await apiFetch('/api/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify({ response: registration })
      })
    },
    onSuccess: async () => {
      toast('Passkey added')
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY })
    },
    onError: (err) => toast(extractErrorMessage(err, "Couldn't add a passkey."), 'danger')
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/auth/passkeys/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Passkey removed', 'neutral')
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY })
    },
    onError: (err) => toast(extractErrorMessage(err, "Couldn't remove the passkey."), 'danger')
  })

  const list = passkeys.data?.passkeys ?? []

  return (
    <Card variant="outlined">
      <Typography level="title-sm">Passkeys</Typography>
      <Typography level="body-sm">Sign in without an email code using your device's biometrics or PIN.</Typography>

      {list.length > 0 && (
        <Stack spacing={1.25} sx={{ mt: 0.5 }}>
          {list.map((pk) => {
            const meta = describePasskey(pk)
            const title = pk.name || meta.providerLabel || meta.defaultLabel
            const details = [
              `Added ${formatDate(pk.createdAt)}`,
              pk.lastUsedAt ? `last used ${formatDate(pk.lastUsedAt)}` : 'never used',
              meta.transportLabel
            ].filter(Boolean)
            return (
              <Stack key={pk.id} direction="row" alignItems="center" spacing={1.25}>
                <Avatar size="sm" variant="soft" color="primary">
                  <KindIcon kind={meta.visualKind} />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Typography level="body-sm" noWrap>
                      {title}
                    </Typography>
                    {meta.providerLabel && pk.name && (
                      <Chip size="sm" variant="soft" color="neutral">
                        {meta.providerLabel}
                      </Chip>
                    )}
                    {pk.backedUp && (
                      <Chip size="sm" variant="soft" color="success">
                        synced
                      </Chip>
                    )}
                  </Stack>
                  <Typography level="body-xs" sx={{ color: 'text.tertiary' }} noWrap>
                    {details.join(' · ')}
                  </Typography>
                </Box>
                <IconButton
                  size="sm"
                  variant="plain"
                  color="danger"
                  loading={remove.isPending && remove.variables === pk.id}
                  onClick={() => remove.mutate(pk.id)}
                  aria-label="Remove passkey"
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            )
          })}
        </Stack>
      )}

      {passkeys.isError && <Alert color="danger">Couldn't load passkeys.</Alert>}

      <Button
        variant="outlined"
        startDecorator={<KeyRoundedIcon />}
        loading={add.isPending}
        onClick={() => add.mutate()}
        sx={{ alignSelf: 'flex-start', mt: 0.5 }}
      >
        Add a passkey
      </Button>
    </Card>
  )
}
