import { test } from 'node:test'
import assert from 'node:assert/strict'
import { immediateSchedule, localCalendarDate, localTimeOfDay } from './immediate-schedule.js'
import { firesRightAway } from './schedule-preview.js'

// Seconds past the minute on purpose: "HH:mm" truncates, so the instant a
// no-date/time reminder resolves to has already slipped into the past by save.
const NOW = new Date(2026, 6, 1, 12, 0, 30) // Jul 1 2026, 12:00:30 local

test('pads date and time to the schema shapes', () => {
  const early = new Date(2026, 0, 5, 9, 7, 0) // Jan 5 2026, 09:07
  assert.equal(localCalendarDate(early), '2026-01-05')
  assert.equal(localTimeOfDay(early), '09:07')
})

test('a reminder created with no date/time fires right away', () => {
  const { schedule, startDate } = immediateSchedule(NOW)
  assert.equal(schedule.kind, 'once')
  assert.deepEqual(schedule.timesOfDay, ['12:00'])
  assert.equal(startDate, '2026-07-01')
  assert.equal(
    firesRightAway(
      { ...schedule, daysOfWeek: [], everyNDays: 1, skipWeekends: false, startDate, endDate: '' },
      NOW
    ),
    true
  )
})

test('the date and time come from the same instant, so they cannot straddle midnight', () => {
  const justBeforeMidnight = new Date(2026, 6, 1, 23, 59, 59)
  const { schedule, startDate } = immediateSchedule(justBeforeMidnight)
  assert.equal(startDate, '2026-07-01')
  assert.deepEqual(schedule.timesOfDay, ['23:59'])
})
