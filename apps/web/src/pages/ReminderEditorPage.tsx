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
import Sheet from '@mui/joy/Sheet'
import Tabs from '@mui/joy/Tabs'
import TabList from '@mui/joy/TabList'
import Tab, { tabClasses } from '@mui/joy/Tab'
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
import { fireSummary } from '../lib/schedule-preview.js'
import { useSettings } from '../settings/useSettings.js'
import { titleCase } from '../lib/format.js'
import { CategoryIcon } from '../components/ReminderIcons.js'
import { COMMON_MEDICATIONS } from '../data/medications.js'
import { useToast } from '../components/ToastProvider.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  once: 'No repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  interval: 'Every N days',
  custom: 'Custom days'
}

// Shared minute presets for the "repeat sound every" and escalation "how late"
// controls (both also allow a custom value).
const MINUTE_PRESETS = [5, 10, 15, 30, 60]

const PERSISTENCE_LABELS: Record<PersistenceLevel, string> = {
  PERSISTENT: 'Notification',
  ALARM: 'Alarm'
}

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
  soundIntervalMinutes: number
  escalate: boolean
  escalateMode: 'after' | 'at'
  escalateAfterMinutes: string
  escalateAtTime: string
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
    soundIntervalMinutes: 0, // 0 = sound once (no re-sound)
    escalate: false,
    escalateMode: 'after',
    escalateAfterMinutes: '15',
    escalateAtTime: '09:00',
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
  const [escalateCustomOpen, setEscalateCustomOpen] = useState(false)
  const [soundCustomOpen, setSoundCustomOpen] = useState(false)
  const toast = useToast()
  const { timeFormat } = useSettings()

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
    const savedMessage = id ? 'Saved' : 'Created'
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
      setError(extractErrorMessage(err))
    }
  }

  async function onDelete() {
    if (!id) return
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
      setError(extractErrorMessage(err))
    }
  }

  const busy = create.isPending || update.isPending
  const fireSummaryText = fireSummary(
    {
      kind: form.kind,
      timesOfDay: form.timesOfDay,
      daysOfWeek: form.daysOfWeek,
      everyNDays: Number(form.everyNDays) || 1,
      skipWeekends: form.skipWeekends,
      startDate: form.startDate,
      endDate: form.endDate
    },
    timeFormat
  )
  const isOnce = form.kind === 'once'
  const needsDays = form.kind === 'weekly' || form.kind === 'custom'
  const needsInterval = form.kind === 'interval'
  const canSkipWeekends = form.kind === 'daily' || form.kind === 'interval'

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
                flex: 1,
                minWidth: 0,
                px: 0,
                fontSize: 'sm',
                fontWeight: 'md',
                color: 'text.tertiary',
                bgcolor: 'transparent',
                // Underline indicator that sits on the TabList's bottom border.
                borderBottom: '2px solid transparent',
                marginBottom: '-1px',
                borderRadius: 0,
                // No focus/selected box — the bottom underline is the only indicator.
                '&:focus, &:focus-visible': { outline: 'none' },
                '&:hover': { bgcolor: 'transparent', color: 'text.secondary' },
                [`&.${tabClasses.selected}`]: {
                  color: 'primary.plainColor',
                  fontWeight: 'lg',
                  borderColor: 'primary.500',
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
              Nagging
            </Tab>
            <Tab value="escalation" disableIndicator>
              Escalation
            </Tab>
          </TabList>

          <TabPanel value="details" keepMounted>
            <Stack spacing={2}>

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

            </Stack>
          </TabPanel>

          <TabPanel value="schedule" keepMounted>
            <Stack spacing={2}>

        <FormControl>
          <FormLabel>Repeat</FormLabel>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {scheduleKinds.map((k) => (
              <Button
                key={k}
                size="sm"
                variant={form.kind === k ? 'solid' : 'outlined'}
                onClick={() => setKind(k)}
              >
                {SCHEDULE_KIND_LABELS[k]}
              </Button>
            ))}
          </Stack>
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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <FormControl sx={{ flex: 1, minWidth: 0 }}>
              <FormLabel>Start date</FormLabel>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
                sx={{ minWidth: 0 }}
              />
            </FormControl>
            <FormControl sx={{ flex: 1, minWidth: 0 }}>
              <FormLabel>End date (optional)</FormLabel>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => set('endDate', e.target.value)}
                sx={{ minWidth: 0 }}
              />
            </FormControl>
          </Stack>
        )}

            </Stack>
          </TabPanel>

          <TabPanel value="nagging" keepMounted>
            <Stack spacing={2}>

        <FormControl>
          <FormLabel>How it notifies</FormLabel>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {persistenceLevels.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={form.persistence === p ? 'solid' : 'outlined'}
                onClick={() => set('persistence', p)}
              >
                {PERSISTENCE_LABELS[p]}
              </Button>
            ))}
          </Stack>
          <Typography level="body-xs" sx={{ mt: 0.5 }}>
            {form.persistence === 'ALARM'
              ? 'Rings continuously until you tap Done.'
              : 'A notification that stays until done. Choose whether it re-sounds to nag you.'}
          </Typography>
        </FormControl>

        {form.persistence === 'PERSISTENT' && (
          <FormControl>
            <FormLabel>Re-sound</FormLabel>
            {(() => {
              const showCustom =
                soundCustomOpen || (form.soundIntervalMinutes > 0 && !MINUTE_PRESETS.includes(form.soundIntervalMinutes))
              return (
                <>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="sm"
                      variant={!showCustom && form.soundIntervalMinutes === 0 ? 'solid' : 'outlined'}
                      onClick={() => {
                        setSoundCustomOpen(false)
                        set('soundIntervalMinutes', 0)
                      }}
                    >
                      Once
                    </Button>
                    {MINUTE_PRESETS.map((minutes) => (
                      <Button
                        key={minutes}
                        size="sm"
                        variant={!showCustom && form.soundIntervalMinutes === minutes ? 'solid' : 'outlined'}
                        onClick={() => {
                          setSoundCustomOpen(false)
                          set('soundIntervalMinutes', minutes)
                        }}
                      >
                        {minutes} min
                      </Button>
                    ))}
                    <Button size="sm" variant={showCustom ? 'solid' : 'outlined'} onClick={() => setSoundCustomOpen(true)}>
                      Custom
                    </Button>
                  </Stack>
                  {showCustom && (
                    <Input
                      type="number"
                      value={form.soundIntervalMinutes}
                      onChange={(e) => set('soundIntervalMinutes', Number(e.target.value) || 1)}
                      slotProps={{ input: { min: 1, max: 60 } }}
                      endDecorator="mins"
                      sx={{ mt: 1 }}
                    />
                  )}
                </>
              )
            })()}
          </FormControl>
        )}

            </Stack>
          </TabPanel>

          <TabPanel value="escalation" keepMounted>
            <Stack spacing={2}>

        <Checkbox
          label="Escalate to an alarm if ignored"
          checked={form.escalate}
          onChange={(e) => set('escalate', e.target.checked)}
        />
        {form.escalate && (
          <Stack spacing={2}>
            <Typography level="body-xs">
              If still not done, it rings an alarm (sound until done) on your devices.
            </Typography>
            <FormControl>
              <FormLabel>Escalate</FormLabel>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="sm"
                  variant={form.escalateMode === 'after' ? 'solid' : 'outlined'}
                  onClick={() => set('escalateMode', 'after')}
                >
                  After a delay
                </Button>
                <Button
                  size="sm"
                  variant={form.escalateMode === 'at' ? 'solid' : 'outlined'}
                  onClick={() => set('escalateMode', 'at')}
                >
                  At a specific time
                </Button>
              </Stack>
            </FormControl>
            {form.escalateMode === 'after' ? (
              <FormControl>
                <FormLabel>How late</FormLabel>
                {(() => {
                  const showCustom =
                    escalateCustomOpen || !MINUTE_PRESETS.includes(Number(form.escalateAfterMinutes))
                  return (
                    <>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {MINUTE_PRESETS.map((minutes) => (
                          <Button
                            key={minutes}
                            size="sm"
                            variant={!showCustom && Number(form.escalateAfterMinutes) === minutes ? 'solid' : 'outlined'}
                            onClick={() => {
                              setEscalateCustomOpen(false)
                              set('escalateAfterMinutes', String(minutes))
                            }}
                          >
                            {minutes} min
                          </Button>
                        ))}
                        <Button
                          size="sm"
                          variant={showCustom ? 'solid' : 'outlined'}
                          onClick={() => setEscalateCustomOpen(true)}
                        >
                          Custom
                        </Button>
                      </Stack>
                      {showCustom && (
                        <Input
                          type="number"
                          value={form.escalateAfterMinutes}
                          onChange={(e) => set('escalateAfterMinutes', e.target.value)}
                          slotProps={{ input: { min: 1, max: 1440 } }}
                          placeholder="Minutes late"
                          endDecorator="mins"
                          sx={{ mt: 1 }}
                        />
                      )}
                    </>
                  )
                })()}
              </FormControl>
            ) : (
              <FormControl>
                <FormLabel>Escalate at</FormLabel>
                <Input type="time" value={form.escalateAtTime} onChange={(e) => set('escalateAtTime', e.target.value)} />
              </FormControl>
            )}
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

        {!form.active ? (
          <Alert color="neutral" variant="soft" size="sm">
            Inactive — won't fire until you turn it on.
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
      </Sheet>
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
    // Alarm rings continuously (no interval). Notification re-sounds every N
    // minutes; 0 = sound once.
    soundIntervalSeconds:
      form.persistence === 'PERSISTENT' && form.soundIntervalMinutes > 0 ? form.soundIntervalMinutes * 60 : null,
    escalateAfterMinutes: form.escalate && form.escalateMode === 'after' ? Number(form.escalateAfterMinutes) || 15 : null,
    escalateAtTime: form.escalate && form.escalateMode === 'at' ? form.escalateAtTime : null,
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
    soundIntervalMinutes:
      reminder.soundIntervalSeconds != null ? Math.max(1, Math.round(reminder.soundIntervalSeconds / 60)) : 0,
    escalate: reminder.escalateAfterMinutes != null || reminder.escalateAtTime != null,
    escalateMode: reminder.escalateAtTime != null ? 'at' : 'after',
    escalateAfterMinutes: reminder.escalateAfterMinutes != null ? String(reminder.escalateAfterMinutes) : '15',
    escalateAtTime: reminder.escalateAtTime ?? '09:00',
    startDate: reminder.startDate,
    endDate: reminder.endDate ?? '',
    active: reminder.active
  }
}
