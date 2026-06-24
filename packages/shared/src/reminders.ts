/**
 * Reminder + schedule + occurrence contracts shared by API and web.
 *
 * A `Reminder` is the definition the user manages. The scheduler expands its
 * `schedule` into `ReminderOccurrence` rows (one per firing). The persistence
 * guarantee = "an occurrence is FIRED and not yet ACKNOWLEDGED".
 */
import { z } from 'zod'

// --- Enums (kept in sync with the Prisma enums of the same name) ---

// Order here drives the category picker order in the UI: none first (the
// default), then task, then medication, then the rest.
export const reminderCategories = ['NONE', 'TASK', 'MEDICATION', 'APPOINTMENT'] as const
export const reminderCategorySchema = z.enum(reminderCategories)
export type ReminderCategory = (typeof reminderCategories)[number]

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
  // A newer firing of the same reminder auto-resolved this still-unconfirmed one,
  // so only the latest occurrence nags (one notification per reminder).
  'SUPERSEDED'
] as const
export const occurrenceStatusSchema = z.enum(occurrenceStatuses)
export type OccurrenceStatus = (typeof occurrenceStatuses)[number]

// --- Schedule ---

export const scheduleKinds = ['once', 'daily', 'weekly', 'interval', 'custom'] as const
export const scheduleKindSchema = z.enum(scheduleKinds)
export type ScheduleKind = (typeof scheduleKinds)[number]

/** "HH:mm" local time-of-day, 24-hour. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')

/**
 * Structured recurrence. Times are interpreted in the owning user's time zone.
 * - once:     fires on `startDate` at each `timesOfDay`, never repeats.
 * - daily:    every day (optionally `skipWeekends`).
 * - weekly:   on the weekdays in `daysOfWeek`.
 * - interval: every `everyNDays` days from `startDate` (optionally `skipWeekends`).
 * - custom:   same as weekly (explicit `daysOfWeek`) — distinct label for UI intent.
 */
export const scheduleSchema = z
  .object({
    kind: scheduleKindSchema,
    timesOfDay: z.array(timeOfDaySchema).min(1).max(24),
    // 0 = Sunday .. 6 = Saturday. Required for weekly/custom.
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    everyNDays: z.number().int().min(1).max(365).optional(),
    skipWeekends: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if ((value.kind === 'weekly' || value.kind === 'custom') && (!value.daysOfWeek || value.daysOfWeek.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['daysOfWeek'], message: 'Pick at least one weekday.' })
    }
    if (value.kind === 'interval' && !value.everyNDays) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['everyNDays'], message: 'Set the day interval.' })
    }
  })
export type Schedule = z.infer<typeof scheduleSchema>

// --- Category-specific data ---

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
 * categoryData under `medications`. (Legacy rows may instead carry a single
 * name/unit/quantity at the top level — readers should fall back to that.)
 */
export const medicationListSchema = z.array(medicationDataSchema).max(20)
export type MedicationList = z.infer<typeof medicationListSchema>

/** Loose JSON bag for per-category fields; medication uses `medicationDataSchema`. */
export const categoryDataSchema = z.record(z.unknown())
export type CategoryData = z.infer<typeof categoryDataSchema>

// --- Display text shared by notifications + cards ---

/** One medication -> "Ibuprofen 200 mg" (missing pieces dropped). */
export function formatMedication(med: MedicationData): string {
  const dose = [med.quantity, med.unit].filter(Boolean).join(' ')
  return [med.name, dose].filter(Boolean).join(' ')
}

/** Medications on a reminder's categoryData (the `medications` array, or a legacy single row). */
export function medicationList(categoryData: CategoryData): MedicationData[] {
  const data = (categoryData ?? {}) as { medications?: MedicationData[] } & MedicationData
  const meds = data.medications?.length
    ? data.medications
    : data.name || data.unit || data.quantity != null
      ? [data]
      : []
  return meds.filter((m) => formatMedication(m) !== '')
}

/** "Ibuprofen 200 mg, Tylenol 500 mg" or '' when there are none. */
export function formatMedications(categoryData: CategoryData): string {
  return medicationList(categoryData).map(formatMedication).join(', ')
}

/** Description for notifications + list cards: medications (if any) then details. */
export function reminderBodyText(source: {
  category: ReminderCategory
  categoryData: CategoryData
  details: string | null
}): string {
  const parts: string[] = []
  if (source.category === 'MEDICATION') {
    const meds = formatMedications(source.categoryData)
    if (meds) parts.push(meds)
  }
  if (source.details) parts.push(source.details)
  return parts.join(' · ')
}

// --- Reminder DTO + create/update inputs ---

export const reminderSchema = z.object({
  id: z.string(),
  title: z.string(),
  details: z.string().nullable(),
  category: reminderCategorySchema,
  categoryData: categoryDataSchema,
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
    category: reminderCategorySchema.default('NONE'),
    categoryData: categoryDataSchema.default({}),
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
  acknowledgedAt: z.string().datetime().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  escalatedAt: z.string().datetime().nullable(),
  // When a newer firing of the same reminder superseded this one (status SUPERSEDED).
  supersededAt: z.string().datetime().nullable(),
  // Instant this occurrence escalates to an alarm if still unacknowledged, or
  // null when no escalation is configured. Computed server-side and populated by
  // /api/sync so native clients can schedule the escalation alarm on-device
  // (server push is otherwise the only escalation path). Optional: only the sync
  // endpoint sets it.
  escalateAt: z.string().datetime().nullable().optional(),
  // Denormalized snapshot of the parent reminder for the "due now" list.
  reminder: reminderSchema.pick({
    title: true,
    details: true,
    category: true,
    categoryData: true,
    persistence: true,
    soundIntervalSeconds: true,
    shadeProminence: true
  })
})
export type Occurrence = z.infer<typeof occurrenceSchema>

export const snoozeInputSchema = z.object({
  minutes: z.number().int().min(1).max(1440)
})
export type SnoozeInput = z.infer<typeof snoozeInputSchema>
