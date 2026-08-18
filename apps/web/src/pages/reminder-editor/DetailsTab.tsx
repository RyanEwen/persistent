/**
 * Details tab: title, the reminder's type, and then the body that type calls for.
 *
 * Type sits above the body because it *chooses* it: for a checklist the item rows
 * replace the free-text textarea outright (the list is the description — see
 * `toInput`, which saves no separate details for a TODO), while medication keeps
 * the textarea and adds its dose rows beneath.
 *
 * The picker offers `typeOptions`, not every type: medication is withheld from
 * new reminders for now (see `selectableReminderTypes`), but a reminder that is
 * already one still edits as one, dose rows and all.
 *
 * Only a *new* reminder focuses the title (`autoFocusTitle`): there the empty
 * field is the next thing to do anyway. Opening an existing one is usually to
 * read it or change something further down, and on a phone the keyboard would
 * cover most of what the user came to see.
 */
import Stack from '@mui/joy/Stack'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Textarea from '@mui/joy/Textarea'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import type { ReminderType } from '@persistent/shared'
import { TypeIcon } from '../../components/ReminderIcons.js'
import { reminderTypeLabel } from '../../lib/format.js'
import { MedicationFields } from './MedicationFields.js'
import { TodoItemsField } from './TodoItemsField.js'
import { typeOptions, type FormState, type MedicationRow, type TodoRow } from './formState.js'

export function DetailsTab({
  form,
  set,
  autoFocusTitle,
  todoCheckedItemIds,
  onToggleTodo,
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
  /** Only a new reminder opens with the title focused — see the header note. */
  autoFocusTitle: boolean
  /** Ticks from the reminder's current firing, if it has one. */
  todoCheckedItemIds?: readonly string[]
  /** Tick one item on that firing — absent when there is no firing to tick. */
  onToggleTodo?: (itemId: string, checked: boolean) => void
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
        <Input value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus={autoFocusTitle} />
      </FormControl>

      <FormControl>
        <FormLabel>Type</FormLabel>
        <Select
          value={form.type}
          onChange={(_e, value) => value && onTypeChange(value)}
          startDecorator={<TypeIcon type={form.type} />}
        >
          {typeOptions(form.type).map((type) => (
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
          checkedItemIds={todoCheckedItemIds}
          onToggle={onToggleTodo}
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
