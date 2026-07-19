import { test } from 'node:test'
import assert from 'node:assert/strict'
import { immediateSchedule, localCalendarDate, localTimeOfDay } from './immediate-schedule.js'
import { firesRightAway } from './schedule-preview.js'

const NOW = new Date(2026, 6, 1, 12, 0, 30) // Jul 1 2026, 12:00:30 local

test('pads date and time to the schema shapes', () => {
  const early = new Date(2026, 0, 5, 9, 7, 0) // Jan 5 2026, 09:07
  assert.equal(localCalendarDate(early), '2026-01-05')
  assert.equal(localTimeOfDay(early), '09:07')
})

test('a reminder created with no date/time is stored as unscheduled', () => {
  // It used to be faked as a one-shot at the creation minute, which the editor
  // could not tell apart from a real one-shot on reload.
  const { schedule, startDate } = immediateSchedule(NOW)
  assert.equal(schedule.kind, 'none')
  assert.deepEqual(schedule.timesOfDay, [])
  // startDate is only a record of when it was created; the firing is anchored to
  // the reminder's createdAt on the server, not to this calendar date.
  assert.equal(startDate, '2026-07-01')
})

test('an unscheduled reminder has no wall-clock fire to back-fill', () => {
  // firesRightAway covers a genuine one-shot whose minute just passed. An
  // unscheduled reminder fires from its creation instant instead, so it must not
  // be routed through that path.
  const { schedule, startDate } = immediateSchedule(NOW)
  assert.equal(
    firesRightAway({ ...schedule, daysOfWeek: [], everyNDays: 1, skipWeekends: false, startDate, endDate: '' }, NOW),
    false
  )
})

test('a genuine one-shot whose minute just passed still fires right away', () => {
  assert.equal(
    firesRightAway(
      {
        kind: 'once',
        timesOfDay: ['12:00'],
        daysOfWeek: [],
        everyNDays: 1,
        skipWeekends: false,
        startDate: '2026-07-01',
        endDate: ''
      },
      NOW
    ),
    true
  )
})
