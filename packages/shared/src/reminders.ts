/**
 * Reminder + schedule + occurrence contracts shared by API and web.
 *
 * A `Reminder` is the definition the user manages. The scheduler expands its
 * `schedule` into `ReminderOccurrence` rows (one per firing). The persistence
 * guarantee = "an occurrence is FIRED and not yet ACKNOWLEDGED".
 */
import { z } from 'zod'

// --- Enums (kept in sync with the Prisma enums of the same name) ---

// What kind of thing the reminder is. A type earns its place by selecting extra
// fields the editor shows and how `reminderBodyText` describes it — TODO its
// checklist, MEDICATION its doses. NONE is the plain default and carries nothing.
// (TASK and APPOINTMENT existed but only ever changed an icon, so they were
// dropped; existing rows fell back to NONE.) Order drives the picker order.
export const reminderTypes = ['NONE', 'TODO', 'MEDICATION'] as const
export const reminderTypeSchema = z.enum(reminderTypes)
export type ReminderType = (typeof reminderTypes)[number]

/**
 * How hard the reminder nags:
 * - PERSISTENT: a notification that re-appears until acknowledged (sounds once).
 * - ALARM: persistent + looping sound/vibration (native full-screen alarm).
 */
export const persistenceLevels = ['PERSISTENT', 'ALARM'] as const
export const persistenceLevelSchema = z.enum(persistenceLevels)
export type PersistenceLevel = (typeof persistenceLevels)[number]

/**
 * How prominently a reminder's notification sits in the Android shade (visual
 * only — it does NOT change sound, which is set by persistence + the nag interval):
 * - INHERIT:   follow the device's default prominence (set per-device in settings).
 * - NORMAL:    main shade area; may pop up a heads-up banner.
 * - MINIMIZED: collapsed "silent" section at the bottom of the shade; no pop-up.
 * Escalations/alarms always stay prominent regardless of this setting.
 */
export const shadeProminenceLevels = ['INHERIT', 'NORMAL', 'MINIMIZED'] as const
export const shadeProminenceSchema = z.enum(shadeProminenceLevels)
export type ShadeProminence = (typeof shadeProminenceLevels)[number]

export const occurrenceStatuses = [
  'PENDING',
  'FIRED',
  'ACKNOWLEDGED',
  'SNOOZED',
  'ESCALATED',
  'MISSED',
  // Legacy: a newer firing used to auto-resolve older still-unconfirmed
  // occurrences of the same reminder. Occurrences are now independent, so the
  // scheduler no longer assigns this — kept only for existing history rows.
  'SUPERSEDED'
] as const
export const occurrenceStatusSchema = z.enum(occurrenceStatuses)
export type OccurrenceStatus = (typeof occurrenceStatuses)[number]

// --- Schedule ---

export const scheduleKinds = ['none', 'once', 'daily', 'weekly', 'monthly', 'interval', 'custom'] as const
export const scheduleKindSchema = z.enum(scheduleKinds)
export type ScheduleKind = (typeof scheduleKinds)[number]

/** "HH:mm" local time-of-day, 24-hour. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')

/**
 * Structured recurrence. Times are interpreted in the owning user's time zone.
 * - none:     no date or time — "remind me about this". Gets exactly one firing,
 *             immediately, when the user asks to be reminded (creating it
 *             unscheduled, or taking an existing reminder's schedule away), then
 *             never again. `timesOfDay` is empty and `startDate` is only a record
 *             of when it was last saved this way — not a window, and nothing
 *             reads it.
 * - once:     fires on `startDate` at each `timesOfDay`, never repeats.
 * - daily:    every day (optionally `skipWeekends`).
 * - weekly:   on the weekdays in `daysOfWeek`.
 * - monthly:  on the calendar days in `daysOfMonth`, and/or the month's last day.
 * - interval: every `everyNDays` days from `startDate` (optionally `skipWeekends`).
 * - custom:   same as weekly (explicit `daysOfWeek`) — distinct label for UI intent.
 *
 * `none` is a real stored state, not a UI mode: an unscheduled reminder must
 * round-trip through the editor as unscheduled rather than reappearing as a
 * one-shot at whatever instant it happened to be created.
 */
export const scheduleSchema = z
  .object({
    kind: scheduleKindSchema,
    // Empty only for `none`, which has no time of day at all (see superRefine).
    timesOfDay: z.array(timeOfDaySchema).max(24),
    // 0 = Sunday .. 6 = Saturday. Required for weekly/custom.
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    // 1..31 calendar days. Monthly only; a day the month doesn't have (the 31st
    // in February) is SKIPPED that month, never clamped back to the 28th — a
    // reminder set for the 31st means the 31st. Use `lastDayOfMonth` for
    // "end of the month", which is what clamping would only approximate.
    daysOfMonth: z.array(z.number().int().min(1).max(31)).max(31).optional(),
    // Monthly only: also fire on whatever the final day of that month is (28-31).
    lastDayOfMonth: z.boolean().optional(),
    everyNDays: z.number().int().min(1).max(365).optional(),
    skipWeekends: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    // Every kind but `none` fires at a wall-clock time, so it needs at least one.
    if (value.kind !== 'none' && value.timesOfDay.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timesOfDay'], message: 'Pick at least one time of day.' })
    }
    if (value.kind === 'none' && value.timesOfDay.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timesOfDay'],
        message: 'An unscheduled reminder has no time of day.'
      })
    }
    if ((value.kind === 'weekly' || value.kind === 'custom') && (!value.daysOfWeek || value.daysOfWeek.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['daysOfWeek'], message: 'Pick at least one weekday.' })
    }
    // Either named days or "last day of the month" satisfies monthly — "the last
    // day" is a complete schedule on its own, with no numbered day to pick.
    if (value.kind === 'monthly' && !value.lastDayOfMonth && !value.daysOfMonth?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['daysOfMonth'],
        message: 'Pick at least one day of the month.'
      })
    }
    if (value.kind === 'interval' && !value.everyNDays) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['everyNDays'], message: 'Set the day interval.' })
    }
  })
export type Schedule = z.infer<typeof scheduleSchema>

// --- Type-specific data ---

/** A single medication on a reminder; the dose itself is quantity + unit. */
export const medicationDataSchema = z.object({
  // The medication's name (e.g. "Ibuprofen").
  name: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(20).optional(),
  quantity: z.number().min(0).max(10_000).optional()
})
export type MedicationData = z.infer<typeof medicationDataSchema>

/**
 * A medication reminder can cover several medications taken together. Stored in
 * typeData under `medications`. (Legacy rows may instead carry a single
 * name/unit/quantity at the top level — readers should fall back to that.)
 */
export const medicationListSchema = z.array(medicationDataSchema).max(20)
export type MedicationList = z.infer<typeof medicationListSchema>

/**
 * One item on a TODO reminder's checklist.
 *
 * `id` is a client-minted stable key, not an index: the checked set lives on the
 * *occurrence* (see `checkedItemIds`), so editing the reminder's list — renaming
 * an item, reordering it, inserting one above — must not silently move a tick
 * from one item to another. Ids are opaque; only their stability matters.
 */
export const todoItemSchema = z.object({
  id: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(200)
})
export type TodoItem = z.infer<typeof todoItemSchema>

/** A TODO reminder's checklist. Stored in typeData under `items`. */
export const todoItemListSchema = z.array(todoItemSchema).max(50)
export type TodoItemList = z.infer<typeof todoItemListSchema>

/** Loose JSON bag for per-type fields; medication uses `medicationDataSchema`, todo `todoItemSchema`. */
export const typeDataSchema = z.record(z.unknown())
export type TypeData = z.infer<typeof typeDataSchema>

// --- Display text shared by notifications + cards ---

/** One medication -> "Ibuprofen 200 mg" (missing pieces dropped). */
export function formatMedication(med: MedicationData): string {
  const dose = [med.quantity, med.unit].filter(Boolean).join(' ')
  return [med.name, dose].filter(Boolean).join(' ')
}

/** Medications on a reminder's typeData (the `medications` array, or a legacy single row). */
export function medicationList(typeData: TypeData): MedicationData[] {
  const data = (typeData ?? {}) as { medications?: MedicationData[] } & MedicationData
  const meds = data.medications?.length
    ? data.medications
    : data.name || data.unit || data.quantity != null
      ? [data]
      : []
  return meds.filter((m) => formatMedication(m) !== '')
}

/** "Ibuprofen 200 mg, Tylenol 500 mg" or '' when there are none. */
export function formatMedications(typeData: TypeData): string {
  return medicationList(typeData).map(formatMedication).join(', ')
}

/**
 * Checklist items on a reminder's typeData. Parsed defensively (typeData is a
 * loose JSON bag that older rows and other types fill differently), so a
 * malformed or absent `items` reads as an empty list rather than throwing.
 */
export function todoItems(typeData: TypeData): TodoItem[] {
  const parsed = todoItemListSchema.safeParse((typeData ?? {}).items ?? [])
  return parsed.success ? parsed.data : []
}

/**
 * The checklist as notification/email text — one item per line, so the native
 * `BigTextStyle` body and the plain-text escalation email both read as a list.
 * Deliberately unticked: a notification is pre-armed on the device and an email
 * is already sent, so neither can track a checked state that moves afterwards.
 */
export function formatTodoItems(typeData: TypeData): string {
  return todoItems(typeData)
    .map((item) => `• ${item.text}`)
    .join('\n')
}

/**
 * How far through a checklist one firing is. `checkedItemIds` is filtered against
 * the reminder's *current* items, so ticks left behind by a since-deleted item
 * never inflate the count past the total.
 */
export function todoProgress(items: TodoItem[], checkedItemIds: readonly string[]): { done: number; total: number } {
  const checked = new Set(checkedItemIds)
  return { done: items.filter((item) => checked.has(item.id)).length, total: items.length }
}

/**
 * Description for notifications + list cards: the type's own content (a
 * medication's doses, a todo's checklist) then details.
 *
 * A checklist is multi-line by nature, so its parts join with newlines rather
 * than the usual middle dot — the surfaces that render this all preserve line
 * breaks (`pre-wrap` in-app, `BigTextStyle` natively, plain text by email), and
 * "• Milk\n• Bread · from the corner shop" would read as part of the last item.
 */
export function reminderBodyText(source: {
  type: ReminderType
  typeData: TypeData
  details: string | null
}): string {
  const parts: string[] = []
  let multiline = false
  if (source.type === 'MEDICATION') {
    const meds = formatMedications(source.typeData)
    if (meds) parts.push(meds)
  }
  if (source.type === 'TODO') {
    const items = formatTodoItems(source.typeData)
    if (items) {
      parts.push(items)
      multiline = true
    }
  }
  if (source.details) parts.push(source.details)
  return parts.join(multiline ? '\n' : ' · ')
}

// --- Reminder DTO + create/update inputs ---

export const reminderSchema = z.object({
  id: z.string(),
  title: z.string(),
  details: z.string().nullable(),
  type: reminderTypeSchema,
  typeData: typeDataSchema,
  schedule: scheduleSchema,
  persistence: persistenceLevelSchema,
  soundIntervalSeconds: z.number().int().nullable(),
  // Android shade prominence (visual only; INHERIT = use the device default).
  shadeProminence: shadeProminenceSchema,
  escalateAfterMinutes: z.number().int().nullable(),
  // Escalate (always to an alarm) either N minutes after firing, or at a specific
  // wall-clock time ("HH:mm") on the occurrence's day. At most one is set.
  escalateAtTime: z.string().nullable(),
  // Optional independent email escalation: email this address (with a custom
  // message) once it's this many minutes overdue.
  escalateEmail: z.string().nullable(),
  escalateEmailMessage: z.string().nullable(),
  escalateEmailAfterMinutes: z.number().int().nullable(),
  active: z.boolean(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  // Status of the most recent occurrence at or before now (done/snoozed/etc.),
  // for the list view. Null when nothing has fired yet.
  lastOccurrence: z
    .object({ status: occurrenceStatusSchema, scheduledFor: z.string().datetime() })
    .nullable()
    .default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type Reminder = z.infer<typeof reminderSchema>

/** "YYYY-MM-DD" calendar date in the user's time zone. */
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const reminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(2000).optional().nullable(),
    type: reminderTypeSchema.default('NONE'),
    typeData: typeDataSchema.default({}),
    schedule: scheduleSchema,
    persistence: persistenceLevelSchema.default('PERSISTENT'),
    // null = no repeating sound; otherwise seconds between sound repeats (up to ~1 year).
    soundIntervalSeconds: z.number().int().min(5).max(31_536_000).nullable().default(null),
    shadeProminence: shadeProminenceSchema.default('INHERIT'),
    // Minutes after firing before escalating to an alarm (up to ~1 year).
    escalateAfterMinutes: z.number().int().min(1).max(525_600).nullable().default(null),
    escalateAtTime: timeOfDaySchema.nullable().default(null),
    escalateEmail: z.string().trim().toLowerCase().email().max(254).nullable().default(null),
    escalateEmailMessage: z.string().trim().max(2000).nullable().default(null),
    escalateEmailAfterMinutes: z.number().int().min(1).max(525_600).nullable().default(null),
    active: z.boolean().default(true),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema.nullable().default(null)
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after the start date.' })
    }
    // A checklist reminder with no checklist is just a reminder — say so rather
    // than saving a TODO the detail view has nothing to render.
    if (value.type === 'TODO') {
      const items = todoItems(value.typeData)
      if (items.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['typeData'], message: 'Add at least one item.' })
      }
      // Item ids key the per-occurrence checked set, so a duplicate would tick two
      // items at once. Rejected here rather than silently de-duplicated: the client
      // mints these, and a collision means its id generator is broken.
      if (new Set(items.map((item) => item.id)).size !== items.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['typeData'], message: 'Checklist items need distinct ids.' })
      }
    }
    // An ALARM already rings continuously until done, so escalation is redundant.
    if (
      value.persistence === 'ALARM' &&
      (value.escalateAfterMinutes != null || value.escalateAtTime != null || value.escalateEmailAfterMinutes != null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['persistence'],
        message: 'Alarm reminders already ring continuously — escalation does not apply.'
      })
    }
  })
export type ReminderInput = z.input<typeof reminderInputSchema>
export type ReminderInputParsed = z.output<typeof reminderInputSchema>

// --- Occurrence DTO ---

export const occurrenceSchema = z.object({
  id: z.string(),
  reminderId: z.string(),
  scheduledFor: z.string().datetime(),
  status: occurrenceStatusSchema,
  firedAt: z.string().datetime().nullable(),
  // When the server last put this firing in front of the user — the fire, a snooze
  // revival, an escalation. `firedAt` can't answer that: it is pinned to the FIRST
  // fire so the escalation backstop stays anchored there, so a snooze revived hours
  // later still reads as old. This is what orders the lists (`firingOrder.ts`).
  lastNotifiedAt: z.string().datetime().nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  escalatedAt: z.string().datetime().nullable(),
  // Legacy: set when a newer firing superseded this one (status SUPERSEDED). No
  // longer produced — occurrences are independent — but kept for old history rows.
  supersededAt: z.string().datetime().nullable(),
  // Instant this occurrence escalates to an alarm if still unacknowledged, or
  // null when no escalation is configured. Computed server-side and populated by
  // /api/sync so native clients can schedule the escalation alarm on-device
  // (server push is otherwise the only escalation path). Optional: only the sync
  // endpoint sets it.
  escalateAt: z.string().datetime().nullable().optional(),
  // TODO reminders: which checklist item ids this firing has ticked off. Held per
  // occurrence, not per reminder, so a repeating checklist starts each firing
  // blank — yesterday's ticks say nothing about today's. Ids of since-deleted
  // items may linger here; read them through `todoProgress`, which filters.
  checkedItemIds: z.array(z.string()).default([]),
  // Denormalized snapshot of the parent reminder for the "due now" list.
  reminder: reminderSchema.pick({
    title: true,
    details: true,
    type: true,
    typeData: true,
    persistence: true,
    soundIntervalSeconds: true,
    shadeProminence: true
  })
})
export type Occurrence = z.infer<typeof occurrenceSchema>

/**
 * Upper bound for a single snooze, in minutes (1 year). Generous so the picker
 * can snooze "until" a future date and the custom number + unit (which goes up
 * to years) stays valid; snoozedUntil just sets a future fire time.
 */
export const MAX_SNOOZE_MINUTES = 525_600

export const snoozeInputSchema = z.object({
  minutes: z.number().int().min(1).max(MAX_SNOOZE_MINUTES)
})
export type SnoozeInput = z.infer<typeof snoozeInputSchema>

/**
 * Tick or untick one checklist item on one firing.
 *
 * Deliberately a per-item toggle rather than "here is the whole checked set":
 * these mutations queue offline and replay later, and a whole-set write would let
 * a stale replay wipe ticks made in the meantime. Each toggle is idempotent, so
 * replaying one twice is harmless.
 */
export const checkItemInputSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  checked: z.boolean()
})
export type CheckItemInput = z.infer<typeof checkItemInputSchema>
