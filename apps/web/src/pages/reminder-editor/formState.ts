/**
 * The reminder editor's form state and its two conversions: `fromReminder`
 * (saved reminder -> editable fields) and `toInput` (editable fields -> the
 * ReminderInput the API takes).
 *
 * The form is deliberately wider than the DTO — it keeps every type's fields
 * (medications, checklist items) and every schedule kind's fields alive at once,
 * so switching type or repeat doesn't discard what the user already typed. The
 * conversions are where that collapses down to just the fields the chosen type
 * and kind actually use.
 */
import type {
  PersistenceLevel,
  Reminder,
  ReminderInput,
  ReminderType,
  Schedule,
  ScheduleKind,
  ShadeProminence
} from '@persistent/shared'
import { todoItems } from '@persistent/shared'
import { immediateSchedule, localCalendarDate, localTimeOfDay } from '../../lib/immediate-schedule.js'
import type { SchedulePreviewInput } from '../../lib/schedule-preview.js'

export interface MedicationRow {
  name: string
  unit: string
  quantity: string
}

export function emptyMedication(): MedicationRow {
  return { name: '', unit: '', quantity: '' }
}

export interface TodoRow {
  /** Stable id, minted here and kept for the life of the item (see `newTodoId`). */
  id: string
  text: string
}

/**
 * A checklist item's id keys the per-occurrence checked set, so it has to be
 * unique and — crucially — *stable* across edits: renaming or reordering an item
 * must not move a tick onto a different one. So ids are minted once, here, and
 * carried through `fromReminder`/`toInput` untouched.
 *
 * `crypto.randomUUID` needs a secure context; the fallback keeps the editor
 * working on a plain-http origin rather than minting colliding ids.
 */
export function newTodoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function emptyTodo(): TodoRow {
  return { id: newTodoId(), text: '' }
}

export interface FormState {
  title: string
  details: string
  type: ReminderType
  medications: MedicationRow[]
  todos: TodoRow[]
  /**
   * False = no date/time at all — schedule kind `none`, which fires once on
   * creation and never again. A real saved state, not just a UI mode, so it
   * round-trips through the editor (see `fromReminder`).
   */
  scheduled: boolean
  kind: ScheduleKind
  timesOfDay: string[]
  daysOfWeek: number[]
  daysOfMonth: number[]
  lastDayOfMonth: boolean
  everyNDays: string
  skipWeekends: boolean
  persistence: PersistenceLevel
  soundIntervalMinutes: number
  shadeProminence: ShadeProminence
  escalate: boolean
  escalateMode: 'after' | 'at'
  escalateAfterMinutes: string
  escalateAtTime: string
  escalateEmailEnabled: boolean
  escalateEmail: string
  escalateEmailMessage: string
  escalateEmailAfterMinutes: string
  startDate: string
  endDate: string
  active: boolean
}

// New reminders default to no repeat; medications repeat daily (the common case).
export function defaultKindForType(type: ReminderType): ScheduleKind {
  return type === 'MEDICATION' ? 'daily' : 'once'
}

export function emptyForm(): FormState {
  return {
    title: '',
    details: '',
    type: 'NONE',
    medications: [emptyMedication()],
    todos: [emptyTodo()],
    // New reminders start unscheduled — the common case is "remind me about this",
    // not "remind me at a time". Picking Schedule reveals the date/time controls.
    scheduled: false,
    kind: defaultKindForType('NONE'),
    timesOfDay: [localTimeOfDay()],
    daysOfWeek: [1, 2, 3, 4, 5],
    // The 1st is the day people mean by "monthly" far more often than any other.
    daysOfMonth: [1],
    lastDayOfMonth: false,
    everyNDays: '2',
    skipWeekends: false,
    persistence: 'PERSISTENT',
    soundIntervalMinutes: 0, // 0 = sound once (no re-sound)
    shadeProminence: 'INHERIT',
    escalate: false,
    escalateMode: 'after',
    escalateAfterMinutes: '15',
    escalateAtTime: '09:00',
    escalateEmailEnabled: false,
    escalateEmail: '',
    escalateEmailMessage: '',
    escalateEmailAfterMinutes: '60',
    startDate: localCalendarDate(),
    endDate: '',
    active: true
  }
}

/** The non-blank checklist rows — the only ones that get saved. */
export function filledTodos(form: FormState): TodoRow[] {
  return form.todos.filter((item) => item.text.trim() !== '')
}

/** A TODO reminder needs at least one item; the editor blocks saving without one. */
export function todoNeedsItems(form: FormState): boolean {
  return form.type === 'TODO' && filledTodos(form).length === 0
}

/**
 * Whether the form differs from the state it was opened in — the question behind
 * "discard your changes?".
 *
 * Compared against the *saved* input rather than the whole form, so the fields the
 * form keeps alive but doesn't save can't raise a false alarm: switching type to
 * Checklist and back leaves the typed medication rows sitting in state, and
 * flipping Repeat around leaves `daysOfWeek` populated for a schedule that no
 * longer uses it. Neither would change what gets written, so neither is a change
 * worth stopping the user over. `toInput` is the same collapse `onSubmit` uses, so
 * "dirty" means exactly "saving now would store something different".
 */
export function isFormDirty(original: FormState, current: FormState): boolean {
  return JSON.stringify(toInput(original)) !== JSON.stringify(toInput(current))
}

export function buildSchedule(form: FormState): Schedule {
  return {
    kind: form.kind,
    timesOfDay: form.timesOfDay,
    ...(form.kind === 'weekly' || form.kind === 'custom' ? { daysOfWeek: form.daysOfWeek } : {}),
    ...(form.kind === 'monthly'
      ? { daysOfMonth: [...form.daysOfMonth].sort((a, b) => a - b), lastDayOfMonth: form.lastDayOfMonth }
      : {}),
    ...(form.kind === 'interval' ? { everyNDays: Number(form.everyNDays) || 1 } : {}),
    ...(form.kind === 'daily' || form.kind === 'interval' ? { skipWeekends: form.skipWeekends } : {})
  }
}

/** The shape `fireSummary` wants, so the editor's preview mirrors what will be saved. */
export function previewInput(form: FormState): SchedulePreviewInput {
  return {
    kind: form.kind,
    timesOfDay: form.timesOfDay,
    daysOfWeek: form.daysOfWeek,
    daysOfMonth: form.daysOfMonth,
    lastDayOfMonth: form.lastDayOfMonth,
    everyNDays: Number(form.everyNDays) || 1,
    skipWeekends: form.skipWeekends,
    startDate: form.startDate,
    endDate: form.endDate
  }
}

export function toInput(form: FormState): ReminderInput {
  // Only the chosen type's own fields are saved — a checklist typed and then
  // switched away from is dropped rather than shipped as dead weight in typeData.
  const typeData: Record<string, unknown> =
    form.type === 'MEDICATION'
      ? {
          medications: form.medications
            .map((m) => ({
              ...(m.name ? { name: m.name } : {}),
              ...(m.unit ? { unit: m.unit } : {}),
              ...(m.quantity ? { quantity: Number(m.quantity) } : {})
            }))
            .filter((m) => Object.keys(m).length > 0)
        }
      : form.type === 'TODO'
        ? { items: filledTodos(form).map((item) => ({ id: item.id, text: item.text.trim() })) }
        : {}

  // "Remind me now": no date/time was picked, so materialize a one-shot at this
  // moment. Resolved here (at submit) rather than at form init so it reflects when
  // the user actually created it, and once for both fields so the date and time
  // can't straddle midnight.
  const immediate = form.scheduled ? null : immediateSchedule()

  const canEscalate = form.persistence !== 'ALARM'
  const escalating = form.escalate && canEscalate
  const emailing = canEscalate && form.escalateEmailEnabled && Boolean(form.escalateEmail.trim())

  return {
    title: form.title,
    // A checklist replaces the details textarea rather than sitting beside it, so
    // the list is the reminder's description and there is no separate details to
    // save. Kept in form state regardless, so switching type back restores what
    // was typed instead of blanking a field the user can't see.
    details: form.type === 'TODO' ? null : form.details || null,
    type: form.type,
    typeData,
    schedule: immediate ? immediate.schedule : buildSchedule(form),
    persistence: form.persistence,
    // Alarm rings continuously (no interval). Notification re-sounds every N
    // minutes; 0 = sound once.
    soundIntervalSeconds:
      form.persistence === 'PERSISTENT' && form.soundIntervalMinutes > 0 ? form.soundIntervalMinutes * 60 : null,
    shadeProminence: form.shadeProminence,
    // ALARM already rings continuously, so escalation doesn't apply there.
    escalateAfterMinutes: escalating && form.escalateMode === 'after' ? Number(form.escalateAfterMinutes) || 15 : null,
    escalateAtTime: escalating && form.escalateMode === 'at' ? form.escalateAtTime : null,
    escalateEmail: emailing ? form.escalateEmail.trim() : null,
    escalateEmailMessage: emailing && form.escalateEmailMessage.trim() ? form.escalateEmailMessage.trim() : null,
    escalateEmailAfterMinutes: emailing ? Number(form.escalateEmailAfterMinutes) || 60 : null,
    active: form.active,
    startDate: immediate ? immediate.startDate : form.startDate,
    endDate: immediate ? null : form.endDate || null
  }
}

export function fromReminder(reminder: Reminder): FormState {
  const schedule = reminder.schedule
  const data = reminder.typeData as {
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
  // Saved ids are carried through untouched — re-minting them here would strand
  // the ticks on every occurrence currently working through this checklist.
  const saved = todoItems(reminder.typeData)
  const todos: TodoRow[] = saved.length > 0 ? saved.map((item) => ({ id: item.id, text: item.text })) : [emptyTodo()]

  return {
    title: reminder.title,
    details: reminder.details ?? '',
    type: reminder.type,
    medications,
    todos,
    // `none` round-trips as unscheduled; anything else has a concrete schedule to
    // edit. Its kind/times fall back to sensible defaults so that switching an
    // unscheduled reminder to Schedule lands on a usable form rather than blanks.
    scheduled: schedule.kind !== 'none',
    kind: schedule.kind === 'none' ? defaultKindForType(reminder.type) : schedule.kind,
    timesOfDay: schedule.timesOfDay.length ? schedule.timesOfDay : [localTimeOfDay()],
    daysOfWeek: schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
    daysOfMonth: schedule.daysOfMonth?.length ? schedule.daysOfMonth : [1],
    lastDayOfMonth: schedule.lastDayOfMonth ?? false,
    everyNDays: schedule.everyNDays != null ? String(schedule.everyNDays) : '2',
    skipWeekends: schedule.skipWeekends ?? false,
    persistence: reminder.persistence,
    soundIntervalMinutes:
      reminder.soundIntervalSeconds != null ? Math.max(1, Math.round(reminder.soundIntervalSeconds / 60)) : 0,
    shadeProminence: reminder.shadeProminence,
    escalate: reminder.escalateAfterMinutes != null || reminder.escalateAtTime != null,
    escalateMode: reminder.escalateAtTime != null ? 'at' : 'after',
    escalateAfterMinutes: reminder.escalateAfterMinutes != null ? String(reminder.escalateAfterMinutes) : '15',
    escalateAtTime: reminder.escalateAtTime ?? '09:00',
    escalateEmailEnabled: reminder.escalateEmail != null,
    escalateEmail: reminder.escalateEmail ?? '',
    escalateEmailMessage: reminder.escalateEmailMessage ?? '',
    escalateEmailAfterMinutes:
      reminder.escalateEmailAfterMinutes != null ? String(reminder.escalateEmailAfterMinutes) : '60',
    startDate: reminder.startDate,
    endDate: reminder.endDate ?? '',
    active: reminder.active
  }
}
