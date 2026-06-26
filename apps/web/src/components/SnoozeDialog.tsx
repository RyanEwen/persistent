/**
 * Snooze duration picker: preset chips, a custom number + unit, or "until" a
 * specific date + time (converted to a minutes-from-now snooze). Used by the
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
import { MAX_SNOOZE_MINUTES } from '@persistent/shared'
import {
  SNOOZE_PRESETS,
  DURATION_UNITS,
  customToMinutes,
  minutesUntilDateTime,
  toDateTimeLocalValue
} from '../lib/durations.js'
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
  const [mode, setMode] = useState<'none' | 'custom' | 'until'>('none')
  // Held as a string so the field can be emptied mid-edit (backspacing the last
  // digit to type a fresh number); coerced to a positive integer only on submit.
  const [value, setValue] = useState('45')
  const [unit, setUnit] = useState('mins')
  const [until, setUntil] = useState(() => toDateTimeLocalValue(new Date()))

  const openMode = (m: 'custom' | 'until') => {
    // Default the "until" picker to an hour out, refreshed each time it opens so
    // it never starts in the past.
    if (m === 'until' && mode !== 'until') {
      const soon = new Date()
      soon.setHours(soon.getHours() + 1)
      setUntil(toDateTimeLocalValue(soon))
    }
    setMode((cur) => (cur === m ? 'none' : m))
  }

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
          <Button size="sm" variant={mode === 'custom' ? 'solid' : 'outlined'} onClick={() => openMode('custom')}>
            Custom
          </Button>
          <Button size="sm" variant={mode === 'until' ? 'solid' : 'outlined'} onClick={() => openMode('until')}>
            Until…
          </Button>
        </Stack>
        {mode === 'custom' && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
            <Input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
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
            <Button
              disabled={busy}
              onClick={() => onSnooze(Math.min(MAX_SNOOZE_MINUTES, customToMinutes(Number(value) || 1, unit)))}
            >
              Snooze
            </Button>
          </Stack>
        )}
        {mode === 'until' && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
            <Input
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Button disabled={busy} onClick={() => onSnooze(minutesUntilDateTime(until))}>
              Snooze
            </Button>
          </Stack>
        )}
      </ModalDialog>
    </BackAwareModal>
  )
}
