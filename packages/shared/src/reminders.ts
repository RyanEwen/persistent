/**
 * Reminder + schedule + occurrence contracts shared by API and web.
 *
 * A `Reminder` is the definition the user manages. The scheduler expands its
 * `schedule` into `ReminderOccurrence` rows (one per firing). The persistence
 * guarantee = "an occurrence is FIRED and not yet ACKNOWLEDGED".
 */
import { z } from 'zod'

// --- Enums (kept in sync with the Prisma enums of the same name) ---

export const reminderCategories = ['MEDICATION', 'TASK', 'APPOINTMENT', 'CUSTOM'] as const
export const reminderCategorySchema = z.enum(reminderCategories)
export type ReminderCategory = (typeof reminderCategories)[number]

/**
 * How hard the reminder nags:
 * - GENTLE: a normal notification.
 * - PERSISTENT: re-fires after dismissal until acknowledged (web best-effort; native ongoing).
 * - ALARM: persistent + looping sound/vibration (native full-screen alarm).
 */
export const persistenceLevels = ['GENTLE', 'PERSISTENT', 'ALARM'] as const
export const persistenceLevelSchema = z.enum(persistenceLevels)
export type PersistenceLevel = (typeof persistenceLevels)[number]

export const occurrenceStatuses = [
  'PENDING',
  'FIRED',
  'ACKNOWLEDGED',
  'SNOOZED',
  'ESCALATED',
  'MISSED'
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

/** Medication details surfaced when category = MEDICATION. */
export const medicationDataSchema = z.object({
  dose: z.string().trim().max(60).optional(),
  unit: z.string().trim().max(20).optional(),
  quantity: z.number().min(0).max(10_000).optional()
})
export type MedicationData = z.infer<typeof medicationDataSchema>

/** Loose JSON bag for per-category fields; medication uses `medicationDataSchema`. */
export const categoryDataSchema = z.record(z.unknown())
export type CategoryData = z.infer<typeof categoryDataSchema>

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
  escalateAfterMinutes: z.number().int().nullable(),
  escalateContactEmail: z.string().nullable(),
  escalateToOwnDevices: z.boolean(),
  active: z.boolean(),
  startDate: z.string(),
  endDate: z.string().nullable(),
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
    category: reminderCategorySchema.default('TASK'),
    categoryData: categoryDataSchema.default({}),
    schedule: scheduleSchema,
    persistence: persistenceLevelSchema.default('PERSISTENT'),
    // null = no repeating sound; otherwise seconds between sound repeats.
    soundIntervalSeconds: z.number().int().min(5).max(3600).nullable().default(null),
    escalateAfterMinutes: z.number().int().min(1).max(1440).nullable().default(null),
    escalateContactEmail: z.string().trim().toLowerCase().email().max(254).nullable().default(null),
    escalateToOwnDevices: z.boolean().default(true),
    active: z.boolean().default(true),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema.nullable().default(null)
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after the start date.' })
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
  // Denormalized snapshot of the parent reminder for the "due now" list.
  reminder: reminderSchema.pick({
    title: true,
    details: true,
    category: true,
    categoryData: true,
    persistence: true,
    soundIntervalSeconds: true
  })
})
export type Occurrence = z.infer<typeof occurrenceSchema>

export const snoozeInputSchema = z.object({
  minutes: z.number().int().min(1).max(1440)
})
export type SnoozeInput = z.infer<typeof snoozeInputSchema>
