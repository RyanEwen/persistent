/**
 * Reminder CRUD. Every query is scoped to the authenticated user. On
 * create/update we immediately materialize near-future occurrences so the next
 * firing doesn't wait for the 5-minute materialization cycle, and fire any that
 * are already due (e.g. a one-shot left at its "now" default) so it nags right
 * away rather than waiting for the tick.
 */
import { Router } from 'express'
import {
  addTodoItemInputSchema,
  checkItemInputSchema,
  hideCheckedInputSchema,
  MAX_TODO_ITEMS,
  reminderInputSchema,
  renameTodoItemInputSchema,
  reorderTodoItemsInputSchema,
  todoItems,
  type TypeData
} from '@persistent/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireUser, requireUserId } from '../lib/auth-middleware.js'
import { badRequest, notFound } from '../lib/http-error.js'
import { toReminder } from '../lib/serializers.js'
import { isStaleWrite } from '../lib/conflict.js'
import { scheduleTransition } from '../lib/schedule-transition.js'
import { materializeReminder, fireDueForReminder, ensureUnscheduledFiring } from '../lib/scheduler.js'
import { broadcast } from '../lib/realtime.js'
import { dispatchToUser, nudgeNativeSync } from '../lib/delivery/index.js'
import { logger } from '../lib/logger.js'

export const remindersRouter = Router()
remindersRouter.use(requireUser)

remindersRouter.get('/', async (request, response) => {
  const userId = requireUserId(request)
  const reminders = await prisma.reminder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    // Latest occurrence at/before now, so the list can show its state (done,
    // snoozed, escalated, missed, due). Future PENDING ones are ignored here.
    include: {
      occurrences: {
        where: { scheduledFor: { lte: new Date() } },
        orderBy: { scheduledFor: 'desc' },
        take: 1
      }
    }
  })
  response.json({ reminders: reminders.map((r) => toReminder(r, r.occurrences[0] ?? null)) })
})

remindersRouter.post('/', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reminderInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reminder.')

  const reminder = await prisma.reminder.create({
    data: { ...toReminderData(parsed.data), userId }
  })

  // An unscheduled reminder's one firing is minted here rather than by
  // materialization (see `ensureUnscheduledFiring`), anchored to the instant the
  // user created it.
  if (parsed.data.schedule.kind === 'none') await ensureUnscheduledFiring(reminder, reminder.createdAt)
  await materializeForUser(reminder.id, userId)
  // Fire right away if the first instant is already due (e.g. a one-shot left at
  // its "now" default), so the reminder nags immediately instead of after a tick.
  await fireDueForReminder(reminder.id)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.status(201).json({ reminder: toReminder(reminder) })
})

remindersRouter.put('/:id', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reminderInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reminder.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')

  // Last-edit-wins: ignore an offline edit that predates the stored version (a
  // newer edit already landed). The stale client reconciles on its next refetch.
  const clientEditedAt = typeof request.body?.clientEditedAt === 'string' ? request.body.clientEditedAt : null
  if (isStaleWrite(clientEditedAt, existing.updatedAt)) {
    response.json({ reminder: toReminder(existing) })
    return
  }

  const reminder = await prisma.reminder.update({
    where: { id: existing.id },
    data: toReminderData(parsed.data)
  })

  // Drop not-yet-fired occurrences so the new schedule re-materializes cleanly.
  await prisma.reminderOccurrence.deleteMany({ where: { reminderId: reminder.id, status: 'PENDING' } })
  // Only moving between a real schedule, no schedule and a note touches an
  // existing firing; see `scheduleTransition` for why each direction does what
  // it does.
  const beforeKind = (existing.schedule as unknown as { kind?: string }).kind ?? ''
  const transition = scheduleTransition(beforeKind, parsed.data.schedule.kind)
  if (transition === 'retire') {
    const retired = await prisma.reminderOccurrence.findMany({
      where: { reminderId: reminder.id, userId, status: { in: ['FIRED', 'ESCALATED', 'SNOOZED'] } },
      select: { id: true }
    })
    if (retired.length > 0) {
      await prisma.reminderOccurrence.deleteMany({ where: { userId, id: { in: retired.map((o) => o.id) } } })
      logger.info('retired live firings on schedule change', {
        reminderId: reminder.id,
        count: retired.length,
        // Which of the two retiring edits this was: gaining a real schedule, or
        // becoming a note. Both drop firings, for different reasons.
        from: beforeKind,
        to: parsed.data.schedule.kind
      })
      // Clear the live notification/alarm on every device, same as a delete does.
      for (const occurrence of retired) {
        broadcast(userId, { type: 'dismiss', occurrenceId: occurrence.id })
        await dispatchToUser(userId, { type: 'dismiss', occurrenceId: occurrence.id }).catch((error) =>
          logger.warn('retire dismiss dispatch failed', { error: String(error), occurrenceId: occurrence.id })
        )
      }
    }
  }
  // Anchored to the edit, not to `createdAt`: this firing exists because the user
  // just took the schedule off, so dating it back to when the reminder was made
  // would put it before the reminder's own start date.
  if (transition === 'mint') await ensureUnscheduledFiring(reminder, reminder.updatedAt)
  await materializeForUser(reminder.id, userId)
  await fireDueForReminder(reminder.id)
  broadcast(userId, { type: 'reminder.changed', reminderId: reminder.id })
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.json({ reminder: toReminder(reminder) })
})

/**
 * Append one item to this reminder's checklist.
 *
 * The add row on a card — Current's attention cards, a note, the detail view —
 * exists so extending a list doesn't mean opening the editor. Kept off `PUT
 * /api/reminders/:id` for the same reason `hide-checked` is: that endpoint
 * replaces the whole definition from the editor form, so routing an added line
 * through it would make a card restate every field it doesn't show, racing a real
 * edit from another device.
 *
 * What it adds is an *item*, and items belong to the reminder — so it joins the
 * definition and every later firing carries it. There is no per-firing item list
 * to add to; only the *ticks* are per firing (docs/notification-behavior.md §1a),
 * and this touches none of them.
 */
remindersRouter.post('/:id/items', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = addTodoItemInputSchema.safeParse(request.body)
  // A fixed message, like its sibling routes: the add row can't produce a blank or
  // over-long item (it trims, and stops at the stored limit), so anything caught
  // here is a client bug rather than something to explain in Zod's words.
  if (!parsed.success) throw badRequest('Invalid checklist item.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  if (existing.type !== 'TODO') throw badRequest('This reminder has no checklist.')
  // Read first for two reasons: a full list is refused with a sentence the user can
  // act on, and the statement below manipulates `typeData.items` as jsonb, which
  // raises on the wrong type rather than returning no rows. Postgres does not
  // promise to evaluate WHERE clauses in order, so a `jsonb_typeof` guard *in the
  // statement* cannot be relied on to run before `jsonb_array_length` — the shape
  // has to be settled out here. Nothing reachable writes a malformed bag (the editor
  // validates, this endpoint appends), and saving once in the editor repairs one.
  const stored = (existing.typeData ?? {}) as { items?: unknown }
  if (typeof stored !== 'object' || Array.isArray(stored) || (stored.items !== undefined && !Array.isArray(stored.items))) {
    throw badRequest("This reminder's checklist needs saving in the editor before items can be added to it.")
  }
  if (todoItems(stored as TypeData).length >= MAX_TODO_ITEMS) {
    throw badRequest(`A checklist holds at most ${MAX_TODO_ITEMS} items.`)
  }

  // Appended in ONE atomic statement, exactly as a tick is: the add row stays open
  // for the next line, so two adds are routinely in flight together, and a
  // read-modify-write would have both read the same list and the second overwrite
  // the first — silently dropping an item the user watched appear.
  //
  // Both clauses carry a rule, not just the message above them: `@>` makes a
  // replayed add a no-op (the client mints the id, so a duplicate id IS the same
  // item arriving twice) and the length check holds the cap when two adds race at 49.
  const { id: itemId, text } = parsed.data
  const appended = await prisma.$executeRaw`
    UPDATE "Reminder"
    SET "typeData" = jsonb_set(
          "typeData",
          '{items}',
          COALESCE("typeData" -> 'items', '[]'::jsonb) ||
            jsonb_build_array(jsonb_build_object('id', ${itemId}::text, 'text', ${text}::text)),
          true
        ),
        -- Bumped, unlike a tick's statement: this changes the definition, so an
        -- older edit replayed from another device must lose to it (isStaleWrite).
        "updatedAt" = NOW()
    WHERE "id" = ${existing.id}
      AND "userId" = ${userId}
      AND NOT COALESCE("typeData" -> 'items', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', ${itemId}::text))
      AND jsonb_array_length(COALESCE("typeData" -> 'items', '[]'::jsonb)) < ${MAX_TODO_ITEMS}
  `
  const updated = await prisma.reminder.findFirstOrThrow({ where: { id: existing.id, userId } })
  // Nothing updated and the item isn't there: a racing add took the last slot
  // between the check above and the statement. An id that IS there is the idempotent
  // case — the stored list is already what the client asked for, so it goes back
  // as-is rather than erroring on a request that has already had its effect.
  if (appended === 0 && !todoItems(updated.typeData as TypeData).some((item) => item.id === itemId)) {
    throw badRequest(`A checklist holds at most ${MAX_TODO_ITEMS} items.`)
  }

  // The new item arrives unticked, so it joins the body of every live firing —
  // which is a tick's problem in reverse, and needs the same nudge: web clients
  // converge on the WS event, native devices re-pull /api/sync/occurrences and
  // re-post the nag silently (`alertOnce`). A note is the exception, as it is for
  // a tick: it notifies nobody, so no device has anything to re-render.
  broadcast(userId, { type: 'reminder.changed', reminderId: updated.id })
  if ((updated.schedule as unknown as { kind?: string }).kind !== 'never') {
    void nudgeNativeSync(userId).catch((error) =>
      logger.warn('checklist add sync nudge failed', { error: String(error), reminderId: updated.id })
    )
  }
  response.json({ reminder: toReminder(updated) })
})

/**
 * Reorder this reminder's checklist — the drag handles on a card, so the order a list
 * is worked through can be changed where it is being worked through rather than only
 * in the editor.
 *
 * The body is a **ranking, not a replacement** (`reorderTodoItemsInputSchema`), and the
 * statement below is what makes that true rather than a promise: it sorts the items the
 * row actually holds, so an id that has since been deleted is ignored and an item added
 * in the meantime keeps its place at the end instead of being dropped. A whole-list
 * write would have deleted whatever the client hadn't heard about yet, which is exactly
 * what a drag on a phone that has been offline for an hour would send.
 *
 * Ticks are untouched — ids are stable, so an item carries its ticked state with it.
 */
remindersRouter.post('/:id/items/order', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = reorderTodoItemsInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid checklist order.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  if (existing.type !== 'TODO') throw badRequest('This reminder has no checklist.')
  // Same shape guard as the add route, and for the same reason: the statement treats
  // `items` as a jsonb array, and Postgres does not promise to evaluate a WHERE-clause
  // type check before the expression that depends on it.
  const stored = (existing.typeData ?? {}) as { items?: unknown }
  if (typeof stored !== 'object' || Array.isArray(stored) || (stored.items !== undefined && !Array.isArray(stored.items))) {
    throw badRequest("This reminder's checklist needs saving in the editor before it can be reordered.")
  }

  // One atomic statement rather than read-modify-write: a reorder rewrites the whole
  // list, so a concurrent add read a moment earlier would be silently undone. Sorting
  // in SQL means the rows being sorted are the rows as they are *now*.
  //
  // `array_position` gives each item its rank; an id that isn't in the ranking returns
  // NULL, and `NULLS LAST` with the original ordinal as the tiebreak leaves those in
  // place at the end. That is the ranking rule, encoded once, matching `withTodoOrder`.
  const { itemIds } = parsed.data
  await prisma.$executeRaw`
    UPDATE "Reminder"
    SET "typeData" = jsonb_set(
          "typeData",
          '{items}',
          COALESCE(
            (
              SELECT jsonb_agg(item ORDER BY array_position(${itemIds}::text[], item ->> 'id') NULLS LAST, ordinality)
              FROM jsonb_array_elements(COALESCE("typeData" -> 'items', '[]'::jsonb)) WITH ORDINALITY AS t(item, ordinality)
            ),
            '[]'::jsonb
          ),
          true
        ),
        "updatedAt" = NOW()
    WHERE "id" = ${existing.id} AND "userId" = ${userId}
  `
  const updated = await prisma.reminder.findFirstOrThrow({ where: { id: existing.id, userId } })

  // The notification body lists the unticked items *in order*, so a reorder changes the
  // text of an already-armed alarm exactly as adding one does — hence the same nudge,
  // and the same exception for a note, which notifies nobody.
  broadcast(userId, { type: 'reminder.changed', reminderId: updated.id })
  if ((updated.schedule as unknown as { kind?: string }).kind !== 'never') {
    void nudgeNativeSync(userId).catch((error) =>
      logger.warn('checklist reorder sync nudge failed', { error: String(error), reminderId: updated.id })
    )
  }
  response.json({ reminder: toReminder(updated) })
})

/**
 * Retitle one checklist item.
 *
 * The third card write on the same list, and the one that changes what a line *says*
 * without changing which line it is: ids and order are untouched, so a firing part-way
 * through the checklist keeps its ticks against the same items. Last-write-wins is the
 * honest model for free text — two devices renaming one line have no merge, and the
 * later edit is the one the user typed most recently.
 *
 * A 404 for an id the list no longer has, rather than re-adding it: a rename queued
 * offline and drained after someone deleted the item must not resurrect it.
 *
 * **Registered after `/:id/items/order` on purpose.** Express matches in registration
 * order, so this parametric route sitting above the literal one swallowed every reorder
 * and answered it with "Invalid checklist item." — a drag that looked like a validation
 * bug. `reminders.routes.test.ts` pins the order, and the guard below means the order
 * being forgotten again costs nothing.
 */
remindersRouter.post('/:id/items/:itemId', async (request, response, next) => {
  // `order` is the sibling route above, not an item id.
  if (request.params.itemId === 'order') return next()

  const userId = requireUserId(request)
  const parsed = renameTodoItemInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid checklist item.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  if (existing.type !== 'TODO') throw badRequest('This reminder has no checklist.')
  // Same shape guard as the sibling routes: the statement treats `items` as a jsonb
  // array and Postgres does not promise to evaluate a type check before the expression
  // depending on it.
  const stored = (existing.typeData ?? {}) as { items?: unknown }
  if (typeof stored !== 'object' || Array.isArray(stored) || (stored.items !== undefined && !Array.isArray(stored.items))) {
    throw badRequest("This reminder's checklist needs saving in the editor before it can be edited here.")
  }
  const itemId = request.params.itemId
  if (!todoItems(stored as TypeData).some((item) => item.id === itemId)) throw notFound('Checklist item not found.')

  // Rebuilt in one statement, like its siblings, so a concurrent add or reorder is not
  // undone by a read-modify-write. Only the matching element's `text` changes; every
  // other element, and the order, passes through as it is.
  const { text } = parsed.data
  await prisma.$executeRaw`
    UPDATE "Reminder"
    SET "typeData" = jsonb_set(
          "typeData",
          '{items}',
          COALESCE(
            (
              SELECT jsonb_agg(
                       CASE WHEN item ->> 'id' = ${itemId}
                         THEN jsonb_set(item, '{text}', to_jsonb(${text}::text))
                         ELSE item
                       END
                       ORDER BY ordinality
                     )
              FROM jsonb_array_elements(COALESCE("typeData" -> 'items', '[]'::jsonb)) WITH ORDINALITY AS t(item, ordinality)
            ),
            '[]'::jsonb
          ),
          true
        ),
        "updatedAt" = NOW()
    WHERE "id" = ${existing.id} AND "userId" = ${userId}
  `
  const updated = await prisma.reminder.findFirstOrThrow({ where: { id: existing.id, userId } })

  // The renamed line is part of the notification body, so an armed alarm's text is now
  // stale — the same nudge adding and reordering send, and the same exception for a
  // note, which notifies nobody.
  broadcast(userId, { type: 'reminder.changed', reminderId: updated.id })
  if ((updated.schedule as unknown as { kind?: string }).kind !== 'never') {
    void nudgeNativeSync(userId).catch((error) =>
      logger.warn('checklist rename sync nudge failed', { error: String(error), reminderId: updated.id })
    )
  }
  response.json({ reminder: toReminder(updated) })
})

/**
 * Tick or untick one item on a **note's** checklist.
 *
 * The mirror of `POST /api/occurrences/:id/check`, and deliberately a separate
 * endpoint rather than a flag on that one: they write different rows because the
 * ticks mean different things. A firing's ticks record what was done *that time*;
 * a note has no firings, so its ticks are simply the state of the list.
 *
 * Restricted to notes for exactly that reason. A scheduled reminder's checklist is
 * ticked per firing, and letting the definition carry ticks too would mean two
 * places holding "what is checked" with nothing to say which one is right.
 */
remindersRouter.post('/:id/check', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = checkItemInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid checklist item.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  if (existing.type !== 'TODO') throw badRequest('This reminder has no checklist.')
  const kind = (existing.schedule as unknown as { kind?: string }).kind
  if (kind !== 'never') throw badRequest('Only a note is ticked off directly; a scheduled reminder is ticked per firing.')

  const items = todoItems((existing.typeData ?? {}) as TypeData)
  if (!items.some((item) => item.id === parsed.data.itemId)) throw notFound('Checklist item not found.')

  // One atomic statement, for the same reason as the occurrence route: working
  // down a list means several taps in quick succession, each its own request, and
  // a read-modify-write loses every tick but the last. `-` then `||` also makes
  // re-ticking idempotent, so an offline replay can't duplicate an id.
  const { itemId, checked } = parsed.data
  await prisma.$executeRaw`
    UPDATE "Reminder"
    SET "checkedItems" = CASE
      WHEN ${checked}::boolean THEN ("checkedItems" - ${itemId}::text) || jsonb_build_array(${itemId}::text)
      ELSE "checkedItems" - ${itemId}::text
    END
    WHERE "id" = ${existing.id} AND "userId" = ${userId}
  `
  const updated = await prisma.reminder.findFirstOrThrow({ where: { id: existing.id, userId } })

  // WS only. A note notifies nobody, so there is no notification to re-render and
  // nothing for a device to re-sync — this just lets the user's other open clients
  // converge on the same list.
  broadcast(userId, { type: 'reminder.changed', reminderId: updated.id })
  response.json({ reminder: toReminder(updated) })
})

/**
 * Collapse or expand the ticked items on this reminder's checklist.
 *
 * A view preference, stored server-side purely so it follows the user between
 * devices — the per-device display prefs live in the web client's localStorage.
 * It changes nothing the user is on the hook for, so unlike a tick it does *not*
 * nudge native sync: notification text is built from the unticked items either
 * way, and no armed alarm goes stale because someone collapsed a list.
 *
 * Kept off `PUT /api/reminders/:id` deliberately. That endpoint replaces the
 * whole definition from the editor form, and this is set by a button on a card
 * the editor never sees — routing it through the form would make every collapse
 * a full-definition write, racing a real edit made on another device.
 */
remindersRouter.post('/:id/hide-checked', async (request, response) => {
  const userId = requireUserId(request)
  const parsed = hideCheckedInputSchema.safeParse(request.body)
  if (!parsed.success) throw badRequest('Invalid checklist view state.')

  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')
  if (existing.type !== 'TODO') throw badRequest('This reminder has no checklist.')

  const updated = await prisma.reminder.update({
    where: { id: existing.id },
    data: { hideCheckedItems: parsed.data.hidden }
  })

  // WS only, for the same reason there is no push: this is what one list looks
  // like, not what the user owes anyone. Other open clients converge; devices
  // have nothing to re-schedule.
  broadcast(userId, { type: 'reminder.changed', reminderId: updated.id })
  response.json({ reminder: toReminder(updated) })
})

remindersRouter.delete('/:id', async (request, response) => {
  const userId = requireUserId(request)
  const existing = await prisma.reminder.findFirst({ where: { id: request.params.id, userId } })
  if (!existing) throw notFound('Reminder not found.')

  // Collect occurrences that may have a live notification/alarm so we can clear
  // them everywhere after the cascade delete.
  const active = await prisma.reminderOccurrence.findMany({
    where: { reminderId: existing.id, userId, status: { in: ['FIRED', 'ESCALATED', 'SNOOZED'] } },
    select: { id: true }
  })

  await prisma.reminder.delete({ where: { id: existing.id } })
  broadcast(userId, { type: 'reminder.changed', reminderId: existing.id })

  // Dismiss any active notification/alarm for the deleted reminder on every device.
  for (const occurrence of active) {
    broadcast(userId, { type: 'dismiss', occurrenceId: occurrence.id })
    await dispatchToUser(userId, { type: 'dismiss', occurrenceId: occurrence.id }).catch((error) =>
      logger.warn('delete dismiss dispatch failed', { error: String(error), occurrenceId: occurrence.id })
    )
  }
  // Nudge native devices to drop the deleted reminder's future on-device alarms.
  void nudgeNativeSync(userId).catch((error) => logger.warn('sync nudge failed', { error: String(error) }))
  response.json({ ok: true })
})

// Shared column mapping for create + update. Excludes userId: create adds it, and
// update must never reassign ownership.
function toReminderData(
  input: ReturnType<typeof reminderInputSchema.parse>
): Omit<Prisma.ReminderUncheckedCreateInput, 'userId'> {
  return {
    title: input.title,
    details: input.details ?? null,
    type: input.type,
    typeData: input.typeData as Prisma.InputJsonValue,
    schedule: input.schedule as unknown as Prisma.InputJsonValue,
    persistence: input.persistence,
    soundIntervalSeconds: input.soundIntervalSeconds,
    sounds: input.sounds as unknown as Prisma.InputJsonValue,
    shadeProminence: input.shadeProminence,
    escalateAfterMinutes: input.escalateAfterMinutes,
    escalateAtTime: input.escalateAtTime,
    escalateEmail: input.escalateEmail,
    escalateEmailMessage: input.escalateEmailMessage,
    escalateEmailAfterMinutes: input.escalateEmailAfterMinutes,
    active: input.active,
    startDate: input.startDate,
    endDate: input.endDate,
    // Ticks against the definition only mean something for a note. The moment one
    // gains a schedule its firings own the checked state again (each starting
    // blank), so leaving these would strand ticks that nothing reads — and hand
    // them back, weeks stale, if it ever became a note again.
    ...(input.schedule.kind === 'never' ? {} : { checkedItems: [] })
    // `hideCheckedItems` is deliberately absent, so an edit leaves it as it was.
    // It is not a field of the form — it's set by a button on the card — and
    // unlike ticks there is nothing stale to strand: it says how to draw a list,
    // so the worst a leftover can do is collapse a checklist the user themselves
    // collapsed, and only once something is ticked again.
  }
}

async function materializeForUser(reminderId: string, userId: string): Promise<void> {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
  if (reminder && user) await materializeReminder(reminder, user.timeZone)
}
