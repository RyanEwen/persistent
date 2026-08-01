/**
 * The medication rows on a MEDICATION reminder: one name + qty + unit block per
 * medication, since a single dose reminder often covers several taken together.
 */
import Stack from '@mui/joy/Stack'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Autocomplete from '@mui/joy/Autocomplete'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import { COMMON_MEDICATIONS } from '../../data/medications.js'
import type { MedicationRow } from './formState.js'

export function MedicationFields({
  medications,
  onChange,
  onAdd,
  onRemove
}: {
  medications: MedicationRow[]
  onChange: (index: number, key: keyof MedicationRow, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <Stack spacing={2}>
      {medications.map((med, index) => (
        <Stack key={index} spacing={1}>
          <FormControl>
            <FormLabel>{medications.length > 1 ? `Medication ${index + 1}` : 'Medication'}</FormLabel>
            <Stack direction="row" spacing={1} alignItems="center">
              <Autocomplete
                sx={{ flex: 1, minWidth: 0 }}
                freeSolo
                autoComplete
                options={COMMON_MEDICATIONS}
                placeholder="Ibuprofen"
                value={med.name}
                onChange={(_e, value) => onChange(index, 'name', value ?? '')}
                inputValue={med.name}
                onInputChange={(_e, value) => onChange(index, 'name', value)}
              />
              {medications.length > 1 && (
                <IconButton variant="outlined" color="danger" onClick={() => onRemove(index)}>
                  ✕
                </IconButton>
              )}
            </Stack>
          </FormControl>
          <Stack direction="row" spacing={1}>
            <FormControl sx={{ flex: 1, minWidth: 0 }}>
              <FormLabel>Qty</FormLabel>
              <Input
                type="number"
                value={med.quantity}
                onChange={(e) => onChange(index, 'quantity', e.target.value)}
                placeholder="200"
              />
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 0 }}>
              <FormLabel>Unit</FormLabel>
              <Input value={med.unit} onChange={(e) => onChange(index, 'unit', e.target.value)} placeholder="mg" />
            </FormControl>
          </Stack>
        </Stack>
      ))}
      <Button variant="outlined" size="sm" onClick={onAdd} sx={{ alignSelf: 'flex-start' }}>
        Add medication
      </Button>
    </Stack>
  )
}
