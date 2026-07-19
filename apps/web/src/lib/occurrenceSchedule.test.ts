import test from 'node:test'
import assert from 'node:assert/strict'
import type { Occurrence, Reminder } from '@persistent/shared'
import { isOutsideReminderWindow } from './occurrenceSchedule.js'

/** A local-zone instant on `day` at 09:00, so the test is not zone-sensitive. */
function occurrenceOn(day: string): Occurrence {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const at = new Date(year, month - 1, date, 9, 0, 0)
  return { scheduledFor: at.toISOString() } as Occurrence
}

function reminderWindow(startDate: string, endDate: string | null = null): Reminder {
  return { startDate, endDate } as Reminder
}

test('a firing before the reminder\'s start date is orphaned', () => {
  // The reported case: fired today, then the reminder was moved to start next week.
  assert.equal(isOutsideReminderWindow(reminderWindow('2026-07-26'), occurrenceOn('2026-07-19')), true)
})

test('a firing after the reminder\'s end date is orphaned', () => {
  assert.equal(isOutsideReminderWindow(reminderWindow('2026-07-01', '2026-07-10'), occurrenceOn('2026-07-19')), true)
})

test('a firing inside the window is not orphaned', () => {
  assert.equal(isOutsideReminderWindow(reminderWindow('2026-07-01', '2026-07-31'), occurrenceOn('2026-07-19')), false)
})

test('a firing on the start date itself is not orphaned', () => {
  assert.equal(isOutsideReminderWindow(reminderWindow('2026-07-19'), occurrenceOn('2026-07-19')), false)
})

test('a firing on the end date itself is not orphaned', () => {
  assert.equal(isOutsideReminderWindow(reminderWindow('2026-07-01', '2026-07-19'), occurrenceOn('2026-07-19')), false)
})

test('an open-ended reminder never orphans a firing after its start', () => {
  assert.equal(isOutsideReminderWindow(reminderWindow('2026-01-01', null), occurrenceOn('2030-01-01')), false)
})
