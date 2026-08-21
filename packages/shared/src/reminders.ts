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
 * The types the editor offers when picking one — currently every type except
 * MEDICATION.
 *
 * **Temporary.** Google Play requires an organization developer account for an
 * app that handles health data, and the switch from an individual account takes
 * up to 30 days; until it lands the app takes on no new health data. MEDICATION
 * stays a fully valid *stored* type throughout — this withholds it from the
 * picker, nothing more. Reminders that already are one keep their doses, still
 * show them everywhere, and still edit as medications (the picker re-admits the
 * type when the reminder it is editing already carries it).
 *
 * To restore: delete this and point the picker back at `reminderTypes`.
 */
export const selectableReminderTypes: readonly ReminderType[] = reminderTypes.filter(
  (type) => type !== 'MEDICATION'
)

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

/**
 * A tone exactly as the user picked it on a device: the URI the system ringtone
 * picker returned, plus the title it was picked under.
 *
 * **The title is not decoration.** A tone URI is device-local — `content://media/…`
 * ids are assigned per device, and a file picked on one phone is simply absent on
 * another — but a *reminder's* sound is a reminder field, so it syncs to every
 * device the account touches. The title is what a second device matches on when
 * the URI doesn't resolve, before falling back to that device's own tone and then
 * to the system default. That chain is what keeps the guarantee: a reminder must
 * never ring silently because it was picked somewhere else. See the resolution
 * order in `docs/alarm-architecture.md`.
 */
export const soundChoiceSchema = z.object({
  uri: z.string().trim().max(2048),
  title: z.string().trim().max(200)
})
export type SoundChoice = z.infer<typeof soundChoiceSchema>

/**
 * The three tones a reminder can override, mirroring the three a device sets —
 * because a fire, a nag and a ringing alarm are different events, not one event at
 * three volumes (`docs/notification-behavior.md`).
 */
export const reminderSoundKinds = ['notification', 'nag', 'alarm'] as const
export type ReminderSoundKind = (typeof reminderSoundKinds)[number]

/**
 * A reminder's own tones. Each is null when the reminder says nothing about that
 * tone — the default, and what every reminder created before this existed carries:
 * the device plays whatever the user chose in its own settings.
 *
 * Android only, like `shadeProminence`: the web/PWA and the Windows tray app have
 * no say over what their OS plays, so they store and display the choice but cannot
 * honour it.
 */
export const reminderSoundsSchema = z.object({
  /** First fire of a soft nag. */
  notification: soundChoiceSchema.nullable().default(null),
  /** Each re-sound of the `soundIntervalSeconds` loop; null also falls back to `notification`. */
  nag: soundChoiceSchema.nullable().default(null),
  /** A ringing alarm — inherent `ALARM` persistence, or an escalation. */
  alarm: soundChoiceSchema.nullable().default(null)
})
export type ReminderSounds = z.infer<typeof reminderSoundsSchema>

/** A reminder that overrides nothing. Fresh object per call — callers mutate form state. */
export function noReminderSounds(): ReminderSounds {
  return { notification: null, nag: null, alarm: null }
}

/**
 * Narrow the loose `sounds` JSON column to the shape the DTO promises. Anything
 * unparseable reads as "overrides nothing", which is the safe answer: the device
 * falls back to its own tone rather than to silence.
 */
export function toReminderSounds(value: unknown): ReminderSounds {
  const parsed = reminderSoundsSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : noReminderSounds()
}

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

export const scheduleKinds = ['none', 'never', 'once', 'daily', 'weekly', 'monthly', 'interval', 'custom'] as const
export const scheduleKindSchema = z.enum(scheduleKinds)
export type ScheduleKind = (typeof scheduleKinds)[number]

/**
 * The two kinds that carry no wall-clock time and that the calendar expansion
 * therefore never produces instants for: `none` (its single firing is minted
 * directly by the server the moment the user asks for it) and `never` (a note —
 * it has no firing at all). Everything else fires at a `timesOfDay`.
 */
export function isTimeless(kind: ScheduleKind): boolean {
  return kind === 'none' || kind === 'never'
}

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
 * - never:    a note. Never fires — not now, not ever. `none` and `never` are the
 *             two kinds with no wall-clock time, and the difference between them
 *             is the whole point: `none` is "remind me about this, now", `never`
 *             is "keep this, don't remind me". A note has no occurrences at all,
 *             so nothing about it can nag, escalate or need confirming.
 * - once:     fires on `startDate` at each `timesOfDay`, never repeats.
 * - daily:    every day (optionally `skipWeekends`).
 * - weekly:   on the weekdays in `daysOfWeek`.
 * - monthly:  on the calendar days in `daysOfMonth`, and/or the month's last day.
 * - interval: every `everyNDays` days from `startDate` (optionally `skipWeekends`).
 * - custom:   same as weekly (explicit `daysOfWeek`) — distinct label for UI intent.
 *
 * `none` and `never` are real stored states, not UI modes: an unscheduled
 * reminder must round-trip through the editor as unscheduled rather than
 * reappearing as a one-shot at whatever instant it happened to be created, and a
 * note must round-trip as a note rather than starting to fire.
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
    // Every kind but the timeless two fires at a wall-clock time, so it needs one.
    if (!isTimeless(value.kind) && value.timesOfDay.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timesOfDay'], message: 'Pick at least one time of day.' })
    }
    if (isTimeless(value.kind) && value.timesOfDay.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timesOfDay'],
        message:
          value.kind === 'never'
            ? 'A note never fires, so it has no time of day.'
            : 'An unscheduled reminder has no time of day.'
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
 * Bounds on one checklist. Both are exported because the surfaces that *add* an
 * item enforce them before the write — the add row on a card stops offering
 * itself at the cap, and its input stops accepting text at the length — so the
 * user meets the limit as a limit rather than as a rejected request.
 */
export const MAX_TODO_ITEMS = 50
export const MAX_TODO_ITEM_TEXT = 200

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
  text: z.string().trim().min(1).max(MAX_TODO_ITEM_TEXT)
})
export type TodoItem = z.infer<typeof todoItemSchema>

/** A TODO reminder's checklist. Stored in typeData under `items`. */
export const todoItemListSchema = z.array(todoItemSchema).max(MAX_TODO_ITEMS)
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
 * `typeData` with one item appended to its checklist — the client-side mirror of
 * what `POST /api/reminders/:id/items` stores, used to apply a card's "Add item"
 * to the cache optimistically.
 *
 * An id the list already carries is returned unchanged rather than appended
 * twice, which is the same rule the endpoint's own statement encodes: ids are
 * client-minted, so a duplicate id *is* the same item arriving twice.
 *
 * Every other key in the bag is carried through untouched — a reminder that was
 * once a medication still holds its doses, and adding a checklist line is not the
 * write that should throw them away.
 */
export function withTodoItem(typeData: TypeData, item: TodoItem): TypeData {
  const items = todoItems(typeData)
  if (items.some((existing) => existing.id === item.id)) return typeData
  return { ...typeData, items: [...items, item] }
}

/**
 * The checklist as notification/email text — one item per line, so the native
 * `BigTextStyle` body and the plain-text escalation email both read as a list.
 *
 * `checkedItemIds` (one firing's ticks) are left OUT: a nag is about what is
 * still outstanding, so an item the user has ticked drops off the notification.
 * The list can therefore be empty even when the reminder has items — a fully
 * ticked firing still nags, because only Done confirms it
 * (`docs/notification-behavior.md` §1a). Callers that render an interactive
 * checklist pass nothing and get every item.
 */
export function formatTodoItems(typeData: TypeData, checkedItemIds: readonly string[] = []): string {
  const checked = new Set(checkedItemIds)
  return todoItems(typeData)
    .filter((item) => !checked.has(item.id))
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
 *
 * `checkedItemIds` are the ticks of the firing this text describes: they drop out
 * of the checklist, so a notification lists only what is left to do. Omit them
 * (the default) for a surface that is not describing one firing's progress.
 */
export function reminderBodyText(
  source: {
    type: ReminderType
    typeData: TypeData
    details: string | null
  },
  checkedItemIds: readonly string[] = []
): string {
  const parts: string[] = []
  let multiline = false
  if (source.type === 'MEDICATION') {
    const meds = formatMedications(source.typeData)
    if (meds) parts.push(meds)
  }
  if (source.type === 'TODO') {
    const items = formatTodoItems(source.typeData, checkedItemIds)
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
  // This reminder's own tones (Android only). Each null = use the device's setting.
  // Defaulted like the other late-added fields, so a reminder cached before the
  // column existed still parses rather than taking the whole view down.
  sounds: reminderSoundsSchema.default(noReminderSounds()),
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
  // NOTES ONLY: which checklist items are ticked on a `TODO` note.
  //
  // Ticks live on the *occurrence* everywhere else (`Occurrence.checkedItemIds`),
  // so a repeating checklist starts each firing blank. A note has no occurrences,
  // so there is nothing for that state to hang off — and equally no ambiguity in
  // hanging it off the reminder, because there is never a firing to disagree with.
  // Always empty for anything that is not a `TODO` note; the server clears it the
  // moment a note gains a schedule.
  checkedItemIds: z.array(z.string()).default([]),
  // View preference: collapse this checklist's ticked items out of the list.
  //
  // Server-stored rather than local, so the state of a list follows the user
  // between devices (the localStorage prefs in `settings/useSettings` are
  // deliberately per-device; this one is per *list*, so it belongs to the list).
  // Purely presentational: it never affects firing, nagging or notification text.
  // Held per reminder rather than per firing because a fresh firing starts with
  // nothing ticked — so a remembered "hidden" hides nothing until the user ticks
  // something, and a long list stays collapsed the way they left it.
  hideCheckedItems: z.boolean().default(false),
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
    // Per-reminder tone overrides; omitted entirely = override nothing, which is
    // what every reminder written before this field existed means.
    sounds: reminderSoundsSchema.default(noReminderSounds()),
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
    const escalates =
      value.escalateAfterMinutes != null || value.escalateAtTime != null || value.escalateEmailAfterMinutes != null
    // An ALARM already rings continuously until done, so escalation is redundant.
    if (value.persistence === 'ALARM' && escalates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['persistence'],
        message: 'Alarm reminders already ring continuously — escalation does not apply.'
      })
    }
    // Escalation chases an *ignored firing*. A note has none, ever, so storing one
    // would be a promise nothing can keep — including an email to a third party.
    if (value.schedule.kind === 'never' && escalates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule'],
        message: 'A note never fires — escalation does not apply.'
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
 * Response shape for `GET /api/occurrences`, whatever the scope.
 *
 * `nextCursor` is only ever populated for `scope=history`, which is the one feed
 * that grows without bound — a year of a three-dose medication is ~1,100 rows,
 * and every row carries a denormalized copy of its reminder. Active and upcoming
 * are naturally small (what is nagging now, what is scheduled next) and are
 * returned whole, so they leave it null.
 *
 * The cursor is an occurrence id, passed back as `?cursor=`. Ids rather than
 * timestamps because several firings can share a `scheduledFor` (a reminder with
 * one time of day and several doses, or a bulk ack), and a timestamp cursor would
 * either skip or repeat the rows on that boundary.
 */
export const occurrenceListSchema = z.object({
  occurrences: z.array(occurrenceSchema),
  /** Pass as `?cursor=` for the next page. Null means this was the last one. */
  nextCursor: z.string().nullable().default(null)
})
export type OccurrenceList = z.infer<typeof occurrenceListSchema>

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

/**
 * Append one item to a reminder's checklist — the add row on a card, which saves
 * opening the editor for the one thing a list needs most often.
 *
 * The **client mints the id**, exactly as the editor does, and here that is also
 * what makes the write idempotent: the server ignores an id the list already
 * carries, so an add replayed after an offline stretch cannot append the item
 * twice. One item at a time rather than "here is the whole list", for the same
 * reason a tick is per item — a whole-list write replayed stale would drop
 * whatever was added in the meantime, and a card has no business restating a
 * definition it only shows part of.
 */
export const addTodoItemInputSchema = todoItemSchema
export type AddTodoItemInput = z.infer<typeof addTodoItemInputSchema>

/**
 * Retitle one checklist item — clicking its text on a card, or typing in its row in
 * the editor, both end here (`POST /api/reminders/:id/items/:itemId`).
 *
 * Per item and last-write-wins, which is the honest model for free text: two devices
 * renaming the same line have no merge, and the later one is the one the user typed
 * most recently. It carries no id of its own because the path names the item, and it
 * cannot add or remove anything — an id that has since been deleted is a 404 rather
 * than a resurrection.
 */
export const renameTodoItemInputSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TODO_ITEM_TEXT)
})
export type RenameTodoItemInput = z.infer<typeof renameTodoItemInputSchema>

/**
 * `typeData` with one item's text replaced — the optimistic-cache mirror of the rename
 * endpoint. Order and ids are untouched, so a firing's ticks stay against the same
 * items: renaming is the one edit that changes what a line *says* without changing
 * which line it is.
 */
export function withTodoItemText(typeData: TypeData, itemId: string, text: string): TypeData {
  const items = todoItems(typeData)
  if (!items.some((item) => item.id === itemId)) return typeData
  return { ...typeData, items: items.map((item) => (item.id === itemId ? { ...item, text } : item)) }
}

/**
 * Reorder a reminder's checklist — the drag handles on a card, so the order a list
 * is worked through can be changed where it is being worked through.
 *
 * The body is a **ranking, not a replacement**, and the server applies it as one:
 * items are sorted by their position in `itemIds`, an id that no longer exists is
 * ignored, and an item the list has gained since (added on another device, or by the
 * user between the drag and its arrival) keeps its place at the end rather than being
 * dropped. That is what makes a stale replay safe — the worst it can do is reshuffle,
 * where a whole-list write would silently delete whatever it hadn't heard about.
 *
 * Reordering never touches a tick. Ids are stable precisely so that moving an item
 * carries its ticked state with it (`todoItemSchema`).
 */
export const reorderTodoItemsInputSchema = z.object({
  itemIds: z.array(z.string().trim().min(1).max(64)).max(MAX_TODO_ITEMS)
})
export type ReorderTodoItemsInput = z.infer<typeof reorderTodoItemsInputSchema>

/**
 * `typeData` with its checklist re-sorted by `itemIds` — the optimistic-cache mirror
 * of `POST /api/reminders/:id/items/order`, and the single statement of the ranking
 * rule the endpoint's SQL encodes.
 */
export function withTodoOrder(typeData: TypeData, itemIds: readonly string[]): TypeData {
  const items = todoItems(typeData)
  const rank = new Map(itemIds.map((id, index) => [id, index]))
  // Anything unranked sorts after everything ranked, keeping its own relative order:
  // it is either new or unknown to whoever sent this, and both mean "leave it be".
  const ordered = items
    .map((item, index) => ({ item, index, rank: rank.get(item.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)
  return { ...typeData, items: ordered }
}

/**
 * Collapse or expand the ticked items on one reminder's checklist.
 *
 * Whole-state rather than a toggle, unlike `checkItemInputSchema`: there is one
 * flag, so a replayed stale write can only restore a view the user themselves
 * chose, and "toggle" replayed twice would land on the opposite of what they
 * asked for.
 */
export const hideCheckedInputSchema = z.object({
  hidden: z.boolean()
})
export type HideCheckedInput = z.infer<typeof hideCheckedInputSchema>
