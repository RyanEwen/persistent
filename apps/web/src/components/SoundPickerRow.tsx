/**
 * One "which tone is this?" row: a label, what it currently sounds like, and a
 * button that opens the system ringtone picker.
 *
 * Shared by the two places tones are chosen, which set different things and read
 * the same: Settings picks the *device's* tones, and the reminder editor picks a
 * *reminder's* overrides of them. The editor's rows can be handed back to the
 * device setting, which is what `onClear` is for; Settings' rows have nothing to
 * fall back to, so they omit it.
 */
import Box from '@mui/joy/Box'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Typography from '@mui/joy/Typography'

export function SoundPickerRow({
  label,
  value,
  onChoose,
  onClear
}: {
  label: string
  /** What this row sounds like right now, already worded for the caller's context. */
  value: string
  /** Absent where there is no picker to open — the web, which cannot choose tones. */
  onChoose?: (() => void) | undefined
  /** Present only when this row overrides something it can be given back to. */
  onClear?: (() => void) | undefined
}) {
  return (
    <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <FormLabel>{label}</FormLabel>
        <Typography level="body-xs">{value}</Typography>
      </Box>
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
        {onClear && (
          <Button size="sm" variant="plain" color="neutral" onClick={onClear}>
            Reset
          </Button>
        )}
        {onChoose && (
          <Button size="sm" variant="outlined" onClick={onChoose}>
            Choose
          </Button>
        )}
      </Stack>
    </FormControl>
  )
}
