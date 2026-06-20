/**
 * Create / edit a reminder: details, category (medication surfaces name + dose fields),
 * the schedule builder, persistence + sound interval, and escalation settings.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Autocomplete from '@mui/joy/Autocomplete'
import Textarea from '@mui/joy/Textarea'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import Switch from '@mui/joy/Switch'
import Checkbox from '@mui/joy/Checkbox'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import Alert from '@mui/joy/Alert'
import Divider from '@mui/joy/Divider'
import Tabs from '@mui/joy/Tabs'
import TabList from '@mui/joy/TabList'
import Tab from '@mui/joy/Tab'
import TabPanel from '@mui/joy/TabPanel'
import {
  extractErrorMessage,
  reminderCategories,
  persistenceLevels,
  scheduleKinds,
  type ReminderCategory,
  type PersistenceLevel,
  type ScheduleKind,
  type ReminderInput,
  type Reminder,
  type Schedule
} from '@persistent/shared'
import { useReminders, useCreateReminder, useUpdateReminder, useDeleteReminder } from '../data/reminders.js'
import { titleCase } from '../lib/format.js'
import { CategoryIcon } from '../components/ReminderIcons.js'
import { COMMON_MEDICATIONS } from '../data/medications.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  once: 'No repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  interval: 'Every N days',
  custom: 'Custom days'
}

// Tappable presets for how often the alarm sound repeats, in minutes.
const SOUND_INTERVAL_PRESETS = [1, 2, 5, 10, 15, 30]

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Current local time rounded up to the next 5-minute mark, as "HH:mm". */
function nextFiveMinuteTime(): string {
  const now = new Date()
  now.setSeconds(0, 0)
  now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5) // 60+ rolls into the next hour
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

interface MedicationRow {
  name: string
  unit: string
  quantity: string
}

function emptyMedication(): MedicationRow {
  return { name: '', unit: '', quantity: '' }
}

interface FormState {
  title: string
  details: string
  category: ReminderCategory
  medications: MedicationRow[]
  kind: ScheduleKind
  timesOfDay: string[]
  daysOfWeek: number[]
  everyNDays: string
  skipWeekends: boolean
  persistence: PersistenceLevel
  repeatSound: boolean
  soundIntervalMinutes: number
  escalate: boolean
  escalateAfterMinutes: string
  escalateContactEmail: string
  escalateToOwnDevices: boolean
  startDate: string
  endDate: string
  active: boolean
}

// New reminders default to no repeat; medications repeat daily (the common case).
function defaultKindForCategory(category: ReminderCategory): ScheduleKind {
  return category === 'MEDICATION' ? 'daily' : 'once'
}

function emptyForm(): FormState {
  return {
    title: '',
    details: '',
    category: 'NONE',
    medications: [emptyMedication()],
    kind: defaultKindForCategory('NONE'),
    timesOfDay: [nextFiveMinuteTime()],
    daysOfWeek: [1, 2, 3, 4, 5],
    everyNDays: '2',
    skipWeekends: false,
    persistence: 'PERSISTENT',
    repeatSound: false,
    soundIntervalMinutes: 1,
    escalate: false,
    escalateAfterMinutes: '15',
    escalateContactEmail: '',
    escalateToOwnDevices: true,
    startDate: todayLocal(),
    endDate: '',
    active: true
  }
}

export function ReminderEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const reminders = useReminders()
  const create = useCreateReminder()
  const update = useUpdateReminder()
  const remove = useDeleteReminder()
  const [error, setError] = useState<string | null>(null)

  const existing = useMemo(() => reminders.data?.find((r) => r.id === id), [reminders.data, id])
  const [form, setForm] = useState<FormState>(() => (existing ? fromReminder(existing) : emptyForm()))

  // If the reminder loads after first render (deep link), hydrate once.
  const [hydratedId, setHydratedId] = useState<string | null>(existing?.id ?? null)
  if (existing && existing.id !== hydratedId) {
    setForm(fromReminder(existing))
    setHydratedId(existing.id)
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

  function addMedication() {
    setForm((prev) => ({ ...prev, medications: [...prev.medications, emptyMedication()] }))
  }

  function removeMedication(index: number) {
    setForm((prev) => ({ ...prev, medications: prev.medications.filter((_m, i) => i !== index) }))
  }

  // For a new reminder, the repeat default tracks the category until the user
  // edits Repeat themselves. Existing reminders keep their saved schedule.
  function setCategory(category: ReminderCategory) {
    setForm((prev) => ({
      ...prev,
      category,
      ...(id ? {} : { kind: defaultKindForCategory(category) })
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
    // Offline, the mutation is queued (optimistically applied to the cache) and
    // replayed on reconnect — so navigate immediately instead of awaiting it.
    if (!navigator.onLine) {
      if (id) update.mutate({ id, input })
      else create.mutate(input)
      navigate('/')
      return
    }
    try {
      if (id) await update.mutateAsync({ id, input })
      else await create.mutateAsync(input)
      navigate('/')
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }

  async function onDelete() {
    if (!id) return
    if (!navigator.onLine) {
      remove.mutate(id)
      navigate('/')
      return
    }
    try {
      await remove.mutateAsync(id)
      navigate('/')
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }

  const busy = create.isPending || update.isPending
  const isOnce = form.kind === 'once'
  const needsDays = form.kind === 'weekly' || form.kind === 'custom'
  const needsInterval = form.kind === 'interval'
  const canSkipWeekends = form.kind === 'daily' || form.kind === 'interval'

  return (
    <form onSubmit={onSubmit}>
      <Stack spacing={2}>
        <Typography level="title-lg">{id ? 'Edit reminder' : 'New reminder'}</Typography>
        {error && <Alert color="danger">{error}</Alert>}

        <FormControl required>
          <FormLabel>Title</FormLabel>
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </FormControl>

        <FormControl>
          <FormLabel>Details</FormLabel>
          <Textarea minRows={2} value={form.details} onChange={(e) => set('details', e.target.value)} />
        </FormControl>

        <FormControl>
          <FormLabel>Category</FormLabel>
          <Select
            value={form.category}
            onChange={(_e, value) => value && setCategory(value)}
            startDecorator={<CategoryIcon category={form.category} />}
          >
            {reminderCategories.map((c) => (
              <Option key={c} value={c}>
                <CategoryIcon category={c} />
                {titleCase(c)}
              </Option>
            ))}
          </Select>
        </FormControl>

        {form.category === 'MEDICATION' && (
          <Stack spacing={2}>
            {form.medications.map((med, index) => (
              <Stack key={index} spacing={1}>
                <FormControl>
                  <FormLabel>{form.medications.length > 1 ? `Medication ${index + 1}` : 'Medication'}</FormLabel>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Autocomplete
                      sx={{ flex: 1, minWidth: 0 }}
                      freeSolo
                      autoComplete
                      options={COMMON_MEDICATIONS}
                      placeholder="Ibuprofen"
                      value={med.name}
                      onChange={(_e, value) => setMedication(index, 'name', value ?? '')}
                      inputValue={med.name}
                      onInputChange={(_e, value) => setMedication(index, 'name', value)}
                    />
                    {form.medications.length > 1 && (
                      <IconButton variant="outlined" color="danger" onClick={() => removeMedication(index)}>
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
                      onChange={(e) => setMedication(index, 'quantity', e.target.value)}
                      placeholder="200"
                    />
                  </FormControl>
                  <FormControl sx={{ flex: 1, minWidth: 0 }}>
                    <FormLabel>Unit</FormLabel>
                    <Input
                      value={med.unit}
                      onChange={(e) => setMedication(index, 'unit', e.target.value)}
                      placeholder="mg"
                    />
                  </FormControl>
                </Stack>
              </Stack>
            ))}
            <Button variant="outlined" size="sm" onClick={addMedication} sx={{ alignSelf: 'flex-start' }}>
              Add medication
            </Button>
          </Stack>
        )}

        <Tabs defaultValue="schedule" variant="outlined" sx={{ borderRadius: 'sm', bgcolor: 'transparent' }}>
          <TabList>
            <Tab value="schedule">Schedule</Tab>
            <Tab value="nagging">Nagging</Tab>
            <Tab value="escalation">Escalation</Tab>
          </TabList>

          <TabPanel value="schedule" keepMounted>
            <Stack spacing={2}>

        <FormControl>
          <FormLabel>Repeat</FormLabel>
          <Select value={form.kind} onChange={(_e, value) => value && setKind(value)}>
            {scheduleKinds.map((k) => (
              <Option key={k} value={k}>
                {SCHEDULE_KIND_LABELS[k]}
              </Option>
            ))}
          </Select>
        </FormControl>

        {isOnce ? (
          <FormControl>
            <FormLabel>Time</FormLabel>
            <Input
              type="time"
              value={form.timesOfDay[0] ?? '08:00'}
              onChange={(e) => set('timesOfDay', [e.target.value])}
            />
          </FormControl>
        ) : (
          <FormControl>
            <FormLabel>Times of day</FormLabel>
            <Stack spacing={1}>
              {form.timesOfDay.map((time, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center">
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) =>
                      set(
                        'timesOfDay',
                        form.timesOfDay.map((t, i) => (i === index ? e.target.value : t))
                      )
                    }
                    sx={{ flex: 1 }}
                  />
                  {form.timesOfDay.length > 1 && (
                    <IconButton
                      variant="outlined"
                      color="danger"
                      onClick={() =>
                        set(
                          'timesOfDay',
                          form.timesOfDay.filter((_t, i) => i !== index)
                        )
                      }
                    >
                      ✕
                    </IconButton>
                  )}
                </Stack>
              ))}
              <Button
                variant="outlined"
                size="sm"
                onClick={() => set('timesOfDay', [...form.timesOfDay, '12:00'])}
              >
                Add time
              </Button>
            </Stack>
          </FormControl>
        )}

        {needsDays && (
          <FormControl>
            <FormLabel>Days of week</FormLabel>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {DAY_NAMES.map((name, day) => (
                <Checkbox
                  key={day}
                  label={name}
                  checked={form.daysOfWeek.includes(day)}
                  onChange={(e) =>
                    set(
                      'daysOfWeek',
                      e.target.checked
                        ? [...form.daysOfWeek, day].sort((a, b) => a - b)
                        : form.daysOfWeek.filter((d) => d !== day)
                    )
                  }
                />
              ))}
            </Stack>
          </FormControl>
        )}

        {needsInterval && (
          <FormControl>
            <FormLabel>Every N days</FormLabel>
            <Input
              type="number"
              value={form.everyNDays}
              onChange={(e) => set('everyNDays', e.target.value)}
              slotProps={{ input: { min: 1, max: 365 } }}
            />
          </FormControl>
        )}

        {canSkipWeekends && (
          <Checkbox
            label="Skip weekends"
            checked={form.skipWeekends}
            onChange={(e) => set('skipWeekends', e.target.checked)}
          />
        )}

        {isOnce ? (
          <FormControl>
            <FormLabel>Date</FormLabel>
            <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </FormControl>
        ) : (
          <Stack direction="row" spacing={1}>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Start date</FormLabel>
              <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </FormControl>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>End date (optional)</FormLabel>
              <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </FormControl>
          </Stack>
        )}

            </Stack>
          </TabPanel>

          <TabPanel value="nagging" keepMounted>
            <Stack spacing={2}>

        <FormControl>
          <FormLabel>Persistence</FormLabel>
          <Select value={form.persistence} onChange={(_e, value) => value && set('persistence', value)}>
            {persistenceLevels.map((p) => (
              <Option key={p} value={p}>
                {p.toLowerCase()}
              </Option>
            ))}
          </Select>
        </FormControl>

        <Checkbox
          label="Repeat sound until confirmed"
          checked={form.repeatSound}
          onChange={(e) => set('repeatSound', e.target.checked)}
        />
        {form.repeatSound && (
          <FormControl>
            <FormLabel>Repeat sound every</FormLabel>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {SOUND_INTERVAL_PRESETS.map((minutes) => (
                <Button
                  key={minutes}
                  size="sm"
                  variant={form.soundIntervalMinutes === minutes ? 'solid' : 'outlined'}
                  onClick={() => set('soundIntervalMinutes', minutes)}
                >
                  {minutes} min
                </Button>
              ))}
            </Stack>
          </FormControl>
        )}

            </Stack>
          </TabPanel>

          <TabPanel value="escalation" keepMounted>
            <Stack spacing={2}>

        <Checkbox
          label="Escalate if ignored"
          checked={form.escalate}
          onChange={(e) => set('escalate', e.target.checked)}
        />
        {form.escalate && (
          <Stack spacing={2}>
            <FormControl>
              <FormLabel>Escalate after (minutes)</FormLabel>
              <Input
                type="number"
                value={form.escalateAfterMinutes}
                onChange={(e) => set('escalateAfterMinutes', e.target.value)}
                slotProps={{ input: { min: 1, max: 1440 } }}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Alarm my own devices</FormLabel>
              <Switch
                checked={form.escalateToOwnDevices}
                onChange={(e) => set('escalateToOwnDevices', e.target.checked)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Also email a contact (optional)</FormLabel>
              <Input
                type="email"
                value={form.escalateContactEmail}
                onChange={(e) => set('escalateContactEmail', e.target.value)}
                placeholder="caregiver@example.com"
              />
            </FormControl>
          </Stack>
        )}

            </Stack>
          </TabPanel>
        </Tabs>

        <Divider />
        <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between' }}>
          <FormLabel>Active</FormLabel>
          <Switch checked={form.active} onChange={(e) => set('active', e.target.checked)} />
        </FormControl>

        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button type="submit" loading={busy} sx={{ flex: 1 }}>
            {id ? 'Save' : 'Create'}
          </Button>
          <Button variant="outlined" color="neutral" onClick={() => navigate('/')}>
            Cancel
          </Button>
        </Stack>
        {id && (
          <Button variant="soft" color="danger" loading={remove.isPending} onClick={onDelete}>
            Delete reminder
          </Button>
        )}
      </Stack>
    </form>
  )
}

function buildSchedule(form: FormState): Schedule {
  return {
    kind: form.kind,
    timesOfDay: form.timesOfDay,
    ...(form.kind === 'weekly' || form.kind === 'custom' ? { daysOfWeek: form.daysOfWeek } : {}),
    ...(form.kind === 'interval' ? { everyNDays: Number(form.everyNDays) || 1 } : {}),
    ...(form.kind === 'daily' || form.kind === 'interval' ? { skipWeekends: form.skipWeekends } : {})
  }
}

function toInput(form: FormState): ReminderInput {
  const categoryData: Record<string, unknown> =
    form.category === 'MEDICATION'
      ? {
          medications: form.medications
            .map((m) => ({
              ...(m.name ? { name: m.name } : {}),
              ...(m.unit ? { unit: m.unit } : {}),
              ...(m.quantity ? { quantity: Number(m.quantity) } : {})
            }))
            .filter((m) => Object.keys(m).length > 0)
        }
      : {}

  return {
    title: form.title,
    details: form.details || null,
    category: form.category,
    categoryData,
    schedule: buildSchedule(form),
    persistence: form.persistence,
    soundIntervalSeconds: form.repeatSound ? form.soundIntervalMinutes * 60 : null,
    escalateAfterMinutes: form.escalate ? Number(form.escalateAfterMinutes) || 15 : null,
    escalateContactEmail: form.escalate && form.escalateContactEmail ? form.escalateContactEmail : null,
    escalateToOwnDevices: form.escalateToOwnDevices,
    active: form.active,
    startDate: form.startDate,
    endDate: form.endDate || null
  }
}

function fromReminder(reminder: Reminder): FormState {
  const schedule = reminder.schedule
  const data = reminder.categoryData as {
    medications?: { name?: string; unit?: string; quantity?: number }[]
    name?: string
    unit?: string
    quantity?: number
  }
  // Prefer the medications array; fall back to a legacy single-medication row.
  const meds =
    data.medications && data.medications.length > 0
      ? data.medications
      : data.name || data.unit || data.quantity != null
        ? [{ name: data.name, unit: data.unit, quantity: data.quantity }]
        : []
  const medications: MedicationRow[] = (meds.length ? meds : [{}]).map((m) => ({
    name: m.name ?? '',
    unit: m.unit ?? '',
    quantity: m.quantity != null ? String(m.quantity) : ''
  }))
  return {
    title: reminder.title,
    details: reminder.details ?? '',
    category: reminder.category,
    medications,
    kind: schedule.kind,
    timesOfDay: schedule.timesOfDay.length ? schedule.timesOfDay : ['08:00'],
    daysOfWeek: schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
    everyNDays: schedule.everyNDays != null ? String(schedule.everyNDays) : '2',
    skipWeekends: schedule.skipWeekends ?? false,
    persistence: reminder.persistence,
    repeatSound: reminder.soundIntervalSeconds != null,
    soundIntervalMinutes:
      reminder.soundIntervalSeconds != null ? Math.max(1, Math.round(reminder.soundIntervalSeconds / 60)) : 1,
    escalate: reminder.escalateAfterMinutes != null,
    escalateAfterMinutes: reminder.escalateAfterMinutes != null ? String(reminder.escalateAfterMinutes) : '15',
    escalateContactEmail: reminder.escalateContactEmail ?? '',
    escalateToOwnDevices: reminder.escalateToOwnDevices,
    startDate: reminder.startDate,
    endDate: reminder.endDate ?? '',
    active: reminder.active
  }
}
