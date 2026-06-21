/**
 * Snooze duration picker: preset chips plus a custom number + unit. Used by the
 * in-app "Needs confirmation" card so Snooze opens a dialog instead of splaying
 * presets inline.
 */
import { useState } from 'react'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogTitle from '@mui/joy/DialogTitle'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import Input from '@mui/joy/Input'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import { SNOOZE_PRESETS, DURATION_UNITS, customToMinutes } from '../lib/durations.js'
import { BackAwareModal } from './BackAwareModal.js'

export function SnoozeDialog({
  open,
  onClose,
  onSnooze,
  busy
}: {
  open: boolean
  onClose: () => void
  onSnooze: (minutes: number) => void
  busy?: boolean
}) {
  const [showCustom, setShowCustom] = useState(false)
  const [value, setValue] = useState(45)
  const [unit, setUnit] = useState('mins')

  return (
    <BackAwareModal open={open} onClose={onClose}>
      <ModalDialog sx={{ maxWidth: 360 }}>
        <DialogTitle>Snooze for…</DialogTitle>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {SNOOZE_PRESETS.map((p) => (
            <Button key={p.minutes} size="sm" variant="soft" disabled={busy} onClick={() => onSnooze(p.minutes)}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant={showCustom ? 'solid' : 'outlined'} onClick={() => setShowCustom((v) => !v)}>
            Custom
          </Button>
        </Stack>
        {showCustom && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
            <Input
              type="number"
              value={value}
              onChange={(e) => setValue(Number(e.target.value) || 1)}
              slotProps={{ input: { min: 1 } }}
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Select value={unit} onChange={(_e, u) => u && setUnit(u)}>
              {DURATION_UNITS.map((u) => (
                <Option key={u.label} value={u.label}>
                  {u.label}
                </Option>
              ))}
            </Select>
            <Button disabled={busy} onClick={() => onSnooze(customToMinutes(value, unit))}>
              Snooze
            </Button>
          </Stack>
        )}
      </ModalDialog>
    </BackAwareModal>
  )
}
