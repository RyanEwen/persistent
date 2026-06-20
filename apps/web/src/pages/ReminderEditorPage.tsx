/**
 * Create / edit a reminder: details, category (medication surfaces dose fields),
 * the schedule builder, persistence + sound interval, and escalation settings.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Textarea from '@mui/joy/Textarea'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import Switch from '@mui/joy/Switch'
import Checkbox from '@mui/joy/Checkbox'
import Button from '@mui/joy/Button'
import IconButton from '@mui/joy/IconButton'
import Alert from '@mui/joy/Alert'
import Divider from '@mui/joy/Divider'
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

interface FormState {
  title: string
  details: string
  category: ReminderCategory
  dose: string
  unit: string
  quantity: string
  kind: ScheduleKind
  timesOfDay: string[]
  daysOfWeek: number[]
  everyNDays: string
  skipWeekends: boolean
  persistence: PersistenceLevel
  repeatSound: boolean
  soundIntervalSeconds: string
  escalate: boolean
  escalateAfterMinutes: string
  escalateContactEmail: string
  escalateToOwnDevices: boolean
  startDate: string
  endDate: string
  active: boolean
}

function emptyForm(): FormState {
  return {
    title: '',
    details: '',
    category: 'TASK',
    dose: '',
    unit: '',
    quantity: '',
    kind: 'daily',
    timesOfDay: ['08:00'],
    daysOfWeek: [1, 2, 3, 4, 5],
    everyNDays: '2',
    skipWeekends: false,
    persistence: 'PERSISTENT',
    repeatSound: false,
    soundIntervalSeconds: '60',
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const input = toInput(form)
      if (id) await update.mutateAsync({ id, input })
      else await create.mutateAsync(input)
      navigate('/')
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }

  async function onDelete() {
    if (!id) return
    await remove.mutateAsync(id)
    navigate('/')
  }

  const busy = create.isPending || update.isPending
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
          <Select value={form.category} onChange={(_e, value) => value && set('category', value)}>
            {reminderCategories.map((c) => (
              <Option key={c} value={c}>
                {c.toLowerCase()}
              </Option>
            ))}
          </Select>
        </FormControl>

        {form.category === 'MEDICATION' && (
          <Stack direction="row" spacing={1}>
            <FormControl sx={{ flex: 2 }}>
              <FormLabel>Dose</FormLabel>
              <Input value={form.dose} onChange={(e) => set('dose', e.target.value)} placeholder="Ibuprofen" />
            </FormControl>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Qty</FormLabel>
              <Input
                type="number"
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                placeholder="200"
              />
            </FormControl>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Unit</FormLabel>
              <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="mg" />
            </FormControl>
          </Stack>
        )}

        <Divider />
        <Typography level="title-sm">Schedule</Typography>

        <FormControl>
          <FormLabel>Repeat</FormLabel>
          <Select value={form.kind} onChange={(_e, value) => value && set('kind', value)}>
            {scheduleKinds.map((k) => (
              <Option key={k} value={k}>
                {k}
              </Option>
            ))}
          </Select>
        </FormControl>

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

        <Divider />
        <Typography level="title-sm">Nagging</Typography>

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
            <FormLabel>Sound interval (seconds)</FormLabel>
            <Input
              type="number"
              value={form.soundIntervalSeconds}
              onChange={(e) => set('soundIntervalSeconds', e.target.value)}
              slotProps={{ input: { min: 5, max: 3600 } }}
            />
          </FormControl>
        )}

        <Divider />
        <Typography level="title-sm">Escalation</Typography>
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
          ...(form.dose ? { dose: form.dose } : {}),
          ...(form.unit ? { unit: form.unit } : {}),
          ...(form.quantity ? { quantity: Number(form.quantity) } : {})
        }
      : {}

  return {
    title: form.title,
    details: form.details || null,
    category: form.category,
    categoryData,
    schedule: buildSchedule(form),
    persistence: form.persistence,
    soundIntervalSeconds: form.repeatSound ? Number(form.soundIntervalSeconds) || 60 : null,
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
  const med = reminder.categoryData as { dose?: string; unit?: string; quantity?: number }
  return {
    title: reminder.title,
    details: reminder.details ?? '',
    category: reminder.category,
    dose: med.dose ?? '',
    unit: med.unit ?? '',
    quantity: med.quantity != null ? String(med.quantity) : '',
    kind: schedule.kind,
    timesOfDay: schedule.timesOfDay.length ? schedule.timesOfDay : ['08:00'],
    daysOfWeek: schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
    everyNDays: schedule.everyNDays != null ? String(schedule.everyNDays) : '2',
    skipWeekends: schedule.skipWeekends ?? false,
    persistence: reminder.persistence,
    repeatSound: reminder.soundIntervalSeconds != null,
    soundIntervalSeconds: reminder.soundIntervalSeconds != null ? String(reminder.soundIntervalSeconds) : '60',
    escalate: reminder.escalateAfterMinutes != null,
    escalateAfterMinutes: reminder.escalateAfterMinutes != null ? String(reminder.escalateAfterMinutes) : '15',
    escalateContactEmail: reminder.escalateContactEmail ?? '',
    escalateToOwnDevices: reminder.escalateToOwnDevices,
    startDate: reminder.startDate,
    endDate: reminder.endDate ?? '',
    active: reminder.active
  }
}
