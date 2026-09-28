/** Count shown on Share buttons for active recipients and pending invitations. */
import Chip from '@mui/joy/Chip'

export function ShareCountChip({ count }: { count: number }) {
  return <Chip component="span" size="sm" variant="soft">{count}</Chip>
}
