/**
 * Create / edit a reminder. This file owns the form state, the save/delete
 * mutations and the tab shell; each tab's fields live in a sibling file, and the
 * state <-> DTO conversions live in `formState.ts`.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Switch from '@mui/joy/Switch'
import Button from '@mui/joy/Button'
import Alert from '@mui/joy/Alert'
import Divider from '@mui/joy/Divider'
import Sheet from '@mui/joy/Sheet'
import Tabs from '@mui/joy/Tabs'
import TabList from '@mui/joy/TabList'
import Tab, { tabClasses } from '@mui/joy/Tab'
import TabPanel from '@mui/joy/TabPanel'
import { extractErrorMessage, type ReminderType, type ScheduleKind } from '@persistent/shared'
import { useReminders, useCreateReminder, useUpdateReminder, useDeleteReminder } from '../../data/reminders.js'
import { fireSummary } from '../../lib/schedule-preview.js'
import { useSettings } from '../../settings/useSettings.js'
import { useToast } from '../../components/ToastProvider.js'
import { setBackInterceptor } from '../../native/backInterceptor.js'
import { parentRoute } from '../../native/useNativeBack.js'
import { DetailsTab } from './DetailsTab.js'
import { ScheduleTab } from './ScheduleTab.js'
import { NotificationsTab } from './NotificationsTab.js'
import { EscalationTab } from './EscalationTab.js'
import { DiscardChangesDialog } from './DiscardChangesDialog.js'
import {
  defaultKindForType,
  emptyForm,
  emptyMedication,
  fromReminder,
  isFormDirty,
  previewInput,
  todoNeedsItems,
  toInput,
  type FormState,
  type MedicationRow,
  type TodoRow
} from './formState.js'

export function ReminderEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const reminders = useReminders()
  const create = useCreateReminder()
  const update = useUpdateReminder()
  const remove = useDeleteReminder()
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const { timeFormat } = useSettings()

  const existing = useMemo(() => reminders.data?.find((r) => r.id === id), [reminders.data, id])
  const [form, setForm] = useState<FormState>(() => (existing ? fromReminder(existing) : emptyForm()))
  // The state the editor was opened in, to tell edits from the untouched form.
  const [original, setOriginal] = useState<FormState>(form)
  // Where to go once the user confirms discarding; null = no prompt showing.
  const [discardTo, setDiscardTo] = useState<string | null>(null)
  // Set while leaving deliberately (saved, deleted, or discarded), so the guard
  // doesn't challenge a departure the user already agreed to.
  const [leaving, setLeaving] = useState(false)

  // If the reminder loads after first render (deep link), hydrate once.
  const [hydratedId, setHydratedId] = useState<string | null>(existing?.id ?? null)
  if (existing && existing.id !== hydratedId) {
    const hydrated = fromReminder(existing)
    setForm(hydrated)
    // Re-baseline too, or the reminder simply arriving would read as an edit.
    setOriginal(hydrated)
    setHydratedId(existing.id)
  }

  const dirty = !leaving && isFormDirty(original, form)

  // Android Back: ask before dropping edits instead of discarding silently.
  useEffect(() => {
    return setBackInterceptor(() => {
      if (!dirty) return false
      setDiscardTo(parentRoute(window.location.pathname) ?? '/')
      return true
    })
  }, [dirty])

  /** Leave for `to`, pausing on the discard prompt when there are unsaved edits. */
  function leaveFor(to: string) {
    if (dirty) setDiscardTo(to)
    else navigate(to)
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function setMedication(index: number, key: keyof MedicationRow, value: string) {
    setForm((prev) => ({
      ...prev,
      medications: prev.medications.map((m, i) => (i === index ? { ...m, [key]: value } : m))
    }))
  }

  // Only the text changes — the row keeps the id it was minted with, so a firing
  // part-way through this checklist keeps its ticks on the right items.
  function setTodo(index: number, text: string) {
    setForm((prev) => ({ ...prev, todos: prev.todos.map((t, i) => (i === index ? { ...t, text } : t)) }))
  }

  // The field mints the row (it needs the id to focus it), so this only places it.
  function insertTodo(index: number, row: TodoRow) {
    setForm((prev) => {
      const todos = [...prev.todos]
      todos.splice(index, 0, row)
      return { ...prev, todos }
    })
  }

  // Reordering moves whole rows, ids included, so it never disturbs the ticks an
  // in-flight firing has already recorded against those items.
  function moveTodo(from: number, to: number) {
    setForm((prev) => {
      if (to < 0 || to >= prev.todos.length || from === to) return prev
      const todos = [...prev.todos]
      const [row] = todos.splice(from, 1)
      todos.splice(to, 0, row!)
      return { ...prev, todos }
    })
  }

  // For a new reminder, the repeat default tracks the type until the user edits
  // Repeat themselves. Existing reminders keep their saved schedule. Medication
  // implies a real schedule, so it also flips the reminder to scheduled — but only
  // ever on, so an explicit Schedule choice is never undone.
  function setType(type: ReminderType) {
    setForm((prev) => ({
      ...prev,
      type,
      ...(id ? {} : { kind: defaultKindForType(type), scheduled: prev.scheduled || type === 'MEDICATION' })
    }))
  }

  // A one-time reminder fires once, so collapse multiple times down to one.
  function setKind(kind: ScheduleKind) {
    setForm((prev) => ({
      ...prev,
      kind,
      timesOfDay: kind === 'once' ? prev.timesOfDay.slice(0, 1) : prev.timesOfDay,
      endDate: kind === 'once' ? '' : prev.endDate
    }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const input = toInput(form)
    const savedMessage = id ? 'Saved' : 'Created'
    setLeaving(true)
    // Capture the edit time now (survives offline queueing) so the server can
    // apply last-edit-wins on replay.
    const editedAt = new Date().toISOString()
    // Offline, the mutation is queued (optimistically applied to the cache) and
    // replayed on reconnect — so navigate immediately instead of awaiting it.
    if (!navigator.onLine) {
      if (id) update.mutate({ id, input, editedAt })
      else create.mutate(input)
      toast(savedMessage)
      navigate('/')
      return
    }
    try {
      if (id) await update.mutateAsync({ id, input, editedAt })
      else await create.mutateAsync(input)
      toast(savedMessage)
      navigate('/')
    } catch (err) {
      // Still here, edits intact — re-arm the guard that the departure disabled.
      setLeaving(false)
      setError(extractErrorMessage(err))
    }
  }

  async function onDelete() {
    if (!id) return
    setLeaving(true)
    if (!navigator.onLine) {
      remove.mutate(id)
      toast('Deleted', 'neutral')
      navigate('/')
      return
    }
    try {
      await remove.mutateAsync(id)
      toast('Deleted', 'neutral')
      navigate('/')
    } catch (err) {
      setLeaving(false)
      setError(extractErrorMessage(err))
    }
  }

  const busy = create.isPending || update.isPending
  // Driven purely by the toggle now that `none` is a real saved state: editing an
  // unscheduled reminder must keep showing it as unscheduled (and offer to give it
  // a schedule) instead of forcing the date/time controls open.
  const showSchedule = form.scheduled
  const fireSummaryText = fireSummary(previewInput(form), timeFormat)
  // Caught here rather than left to the server: saving offline queues the mutation
  // and navigates away, so a rejection would surface much later as a stray toast.
  const missingTodoItems = todoNeedsItems(form)

  return (
    <form onSubmit={onSubmit}>
      <Sheet variant="outlined" sx={{ p: 2, borderRadius: 'md', bgcolor: 'background.surface' }}>
        <Stack spacing={2}>
          <Typography level="title-lg">{id ? 'Edit reminder' : 'New reminder'}</Typography>
          {error && <Alert color="danger">{error}</Alert>}

          <Tabs defaultValue="details" sx={{ bgcolor: 'transparent' }}>
            <TabList
              disableUnderline
              sx={{
                gap: 1,
                borderRadius: 0,
                borderBottom: '1px solid',
                borderColor: 'divider',
                [`& .${tabClasses.root}`]: {
                  // `1 1 auto`, not `flex: 1` (= `1 1 0%`): a zero basis makes every
                  // tab an equal slice regardless of its label, so "Details" claims
                  // as much width as "Notifications" and the underlines read as
                  // arbitrary. An auto basis sizes each tab from its own text and
                  // shares only the leftover space, so the row still fills.
                  flex: '1 1 auto',
                  minWidth: 0,
                  px: 1,
                  py: 1.25,
                  minHeight: 48, // comfortable touch target
                  fontSize: 'sm',
                  fontWeight: 'md',
                  color: 'text.tertiary',
                  bgcolor: 'transparent',
                  // Only a bottom edge — kill the default all-sides border so the
                  // active color can't paint a full box.
                  border: 'none',
                  borderBottom: '2px solid transparent',
                  marginBottom: '-1px',
                  borderRadius: 0,
                  // No focus/selected box — the bottom underline is the only indicator.
                  '&:focus, &:focus-visible': { outline: 'none' },
                  '&:hover': { bgcolor: 'transparent', color: 'primary.plainColor' },
                  [`&.${tabClasses.selected}`]: {
                    color: 'primary.plainColor',
                    fontWeight: 'lg',
                    borderBottomColor: 'primary.500',
                    bgcolor: 'transparent'
                  }
                }
              }}
            >
              <Tab value="details" disableIndicator>
                Details
              </Tab>
              <Tab value="schedule" disableIndicator>
                Schedule
              </Tab>
              <Tab value="nagging" disableIndicator>
                Notifications
              </Tab>
              <Tab value="escalation" disableIndicator>
                Escalation
              </Tab>
            </TabList>

            <TabPanel value="details" keepMounted>
              <DetailsTab
                form={form}
                set={set}
                onTypeChange={setType}
                onMedicationChange={setMedication}
                onAddMedication={() => setForm((prev) => ({ ...prev, medications: [...prev.medications, emptyMedication()] }))}
                onRemoveMedication={(index) =>
                  setForm((prev) => ({ ...prev, medications: prev.medications.filter((_m, i) => i !== index) }))
                }
                onTodoChange={setTodo}
                onInsertTodo={insertTodo}
                onMoveTodo={moveTodo}
                onRemoveTodo={(index) =>
                  setForm((prev) => ({ ...prev, todos: prev.todos.filter((_t, i) => i !== index) }))
                }
              />
            </TabPanel>

            <TabPanel value="schedule" keepMounted>
              <ScheduleTab form={form} set={set} onKindChange={setKind} isEditing={Boolean(id)} />
            </TabPanel>

            <TabPanel value="nagging" keepMounted>
              <NotificationsTab form={form} set={set} />
            </TabPanel>

            <TabPanel value="escalation" keepMounted>
              <EscalationTab form={form} set={set} />
            </TabPanel>
          </Tabs>

          <Divider />
          <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between' }}>
            <FormLabel>Active</FormLabel>
            <Switch checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          </FormControl>

          {missingTodoItems ? (
            <Alert color="warning" variant="soft" size="sm">
              Add at least one checklist item on the Details tab.
            </Alert>
          ) : !form.active ? (
            <Alert color="neutral" variant="soft" size="sm">
              Inactive — won't fire until you turn it on.
            </Alert>
          ) : !showSchedule ? (
            // An unscheduled reminder fires once, on creation — so this is a promise
            // when creating one and a statement of history when editing one.
            <Alert color={id ? 'neutral' : 'primary'} variant="soft" size="sm">
              {id ? 'Already fired when you created it — nothing more scheduled.' : 'Fires right away'}
            </Alert>
          ) : fireSummaryText ? (
            <Alert color="primary" variant="soft" size="sm">
              {fireSummaryText}
            </Alert>
          ) : (
            <Alert color="warning" variant="soft" size="sm">
              No upcoming fire — check the date and time.
            </Alert>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button type="submit" loading={busy} disabled={missingTodoItems} sx={{ flex: 1 }}>
              {id ? 'Save' : 'Create'}
            </Button>
            <Button variant="outlined" color="neutral" onClick={() => leaveFor('/')}>
              Cancel
            </Button>
          </Stack>
          {id && (
            <Button
              variant="plain"
              color="danger"
              size="sm"
              loading={remove.isPending}
              onClick={onDelete}
              sx={{ alignSelf: 'center', mt: 0.5 }}
            >
              Delete reminder
            </Button>
          )}
        </Stack>
      </Sheet>
      <DiscardChangesDialog
        open={discardTo !== null}
        onKeepEditing={() => setDiscardTo(null)}
        onDiscard={() => {
          const to = discardTo ?? '/'
          setDiscardTo(null)
          setLeaving(true)
          navigate(to)
        }}
      />
    </form>
  )
}
