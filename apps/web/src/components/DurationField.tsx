/**
 * Duration picker used for "re-sound" and escalation "how late": a row of preset
 * buttons (plus an optional extra like "Once"), and a Custom option that reveals
 * a number + unit selector. Value is in minutes.
 */
import { useState } from 'react'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import Input from '@mui/joy/Input'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import { DURATION_PRESETS, DURATION_UNITS, customToMinutes, minutesToCustom, type DurationPreset } from '../lib/durations.js'

export function DurationField({
  value,
  onChange,
  presets = DURATION_PRESETS,
  extra
}: {
  value: number
  onChange: (minutes: number) => void
  presets?: DurationPreset[]
  extra?: { label: string; value: number }
}) {
  const isExtra = !!extra && value === extra.value
  const matchedPreset = presets.find((p) => p.minutes === value)
  const [customOpen, setCustomOpen] = useState(false)
  const showCustom = customOpen || (!isExtra && !matchedPreset)
  const [unit, setUnit] = useState(() => minutesToCustom(value || 5).unit)
  const unitMinutes = DURATION_UNITS.find((u) => u.label === unit)?.minutes ?? 1
  const shownValue = Math.round((value / unitMinutes) * 100) / 100

  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {extra && (
          <Button
            size="sm"
            variant={isExtra && !customOpen ? 'solid' : 'outlined'}
            onClick={() => {
              setCustomOpen(false)
              onChange(extra.value)
            }}
          >
            {extra.label}
          </Button>
        )}
        {presets.map((p) => (
          <Button
            key={p.minutes}
            size="sm"
            variant={!showCustom && value === p.minutes ? 'solid' : 'outlined'}
            onClick={() => {
              setCustomOpen(false)
              onChange(p.minutes)
            }}
          >
            {p.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={showCustom ? 'solid' : 'outlined'}
          onClick={() => {
            setUnit(minutesToCustom(value || 5).unit)
            setCustomOpen(true)
          }}
        >
          Custom
        </Button>
      </Stack>
      {showCustom && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Input
            type="number"
            value={shownValue}
            onChange={(e) => onChange(customToMinutes(Number(e.target.value) || 1, unit))}
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
        </Stack>
      )}
    </>
  )
}
