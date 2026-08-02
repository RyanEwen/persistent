/**
 * Details tab: title, the reminder's type, and then the body that type calls for.
 *
 * Type sits above the body because it *chooses* it: for a checklist the item rows
 * replace the free-text textarea outright (the list is the description — see
 * `toInput`, which saves no separate details for a TODO), while medication keeps
 * the textarea and adds its dose rows beneath.
 */
import Stack from '@mui/joy/Stack'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Textarea from '@mui/joy/Textarea'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import { reminderTypes, type ReminderType } from '@persistent/shared'
import { TypeIcon } from '../../components/ReminderIcons.js'
import { reminderTypeLabel } from '../../lib/format.js'
import { MedicationFields } from './MedicationFields.js'
import { TodoItemsField, type TodoCheckState } from './TodoItemsField.js'
import type { FormState, MedicationRow, TodoRow } from './formState.js'

export function DetailsTab({
  form,
  set,
  todoChecked,
  onTypeChange,
  onMedicationChange,
  onAddMedication,
  onRemoveMedication,
  onTodoChange,
  onInsertTodo,
  onMoveTodo,
  onRemoveTodo
}: {
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  /** Read-only ticks from the reminder's current firing, if it has one. */
  todoChecked?: TodoCheckState
  onTypeChange: (type: ReminderType) => void
  onMedicationChange: (index: number, key: keyof MedicationRow, value: string) => void
  onAddMedication: () => void
  onRemoveMedication: (index: number) => void
  onTodoChange: (index: number, text: string) => void
  onInsertTodo: (index: number, row: TodoRow) => void
  onMoveTodo: (index: number, delta: number) => void
  onRemoveTodo: (index: number) => void
}) {
  return (
    <Stack spacing={2}>
      <FormControl required>
        <FormLabel>Title</FormLabel>
        <Input value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus />
      </FormControl>

      <FormControl>
        <FormLabel>Type</FormLabel>
        <Select
          value={form.type}
          onChange={(_e, value) => value && onTypeChange(value)}
          startDecorator={<TypeIcon type={form.type} />}
        >
          {reminderTypes.map((type) => (
            <Option key={type} value={type}>
              <TypeIcon type={type} />
              {reminderTypeLabel(type)}
            </Option>
          ))}
        </Select>
      </FormControl>

      {form.type === 'TODO' ? (
        <TodoItemsField
          todos={form.todos}
          checked={todoChecked}
          onChange={onTodoChange}
          onInsert={onInsertTodo}
          onMove={onMoveTodo}
          onRemove={onRemoveTodo}
        />
      ) : (
        <FormControl>
          <FormLabel>Details</FormLabel>
          <Textarea minRows={2} value={form.details} onChange={(e) => set('details', e.target.value)} />
        </FormControl>
      )}

      {form.type === 'MEDICATION' && (
        <MedicationFields
          medications={form.medications}
          onChange={onMedicationChange}
          onAdd={onAddMedication}
          onRemove={onRemoveMedication}
        />
      )}
    </Stack>
  )
}
