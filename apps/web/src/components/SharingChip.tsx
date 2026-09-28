/** A small, read-only marker for reminder cards with an active share or invitation. */
import Chip from '@mui/joy/Chip'
import ShareIcon from '@mui/icons-material/Share'
import type { SharingState } from './sharingState.js'

export function SharingChip({ state }: { state: SharingState }) {
  if (!state) return null
  return (
    <Chip component="span" size="sm" variant="soft" color="neutral" startDecorator={<ShareIcon sx={{ fontSize: 14 }} />}>
      {state === 'shared' ? 'Shared' : 'Invited'}
    </Chip>
  )
}
