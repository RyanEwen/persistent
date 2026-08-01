import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { expandSchedule } from './schedule-expand.js'
import type { Schedule } from '@persistent/shared'

const TZ = 'America/Toronto'

function window(fromIso: string, toIso: string) {
  return {
    from: DateTime.fromISO(fromIso, { zone: TZ }).toJSDate(),
    to: DateTime.fromISO(toIso, { zone: TZ }).toJSDate()
  }
}

function localTimes(dates: Date[]): string[] {
  return dates.map((d) => DateTime.fromJSDate(d, { zone: TZ }).toFormat('yyyy-MM-dd HH:mm'))
}

test('daily schedule fires once per day at the local time', () => {
  const schedule: Schedule = { kind: 'daily', timesOfDay: ['08:00'] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-06-04T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-01 08:00', '2026-06-02 08:00', '2026-06-03 08:00'])
})

test('daily with skipWeekends drops Saturday and Sunday', () => {
  // 2026-06-05 is a Friday; 06-06 Sat, 06-07 Sun, 06-08 Mon.
  const schedule: Schedule = { kind: 'daily', timesOfDay: ['09:00'], skipWeekends: true }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-05',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-05T00:00', '2026-06-09T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-05 09:00', '2026-06-08 09:00'])
})

test('weekly fires only on selected weekdays', () => {
  // Mondays (1) and Thursdays (4) in our 0=Sun..6=Sat scheme.
  const schedule: Schedule = { kind: 'weekly', timesOfDay: ['07:30'], daysOfWeek: [1, 4] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-06-08T00:00')
  })
  // Week of Jun 1 (Mon) .. Jun 7 (Sun): Mon Jun 1, Thu Jun 4.
  assert.deepEqual(localTimes(dates), ['2026-06-01 07:30', '2026-06-04 07:30'])
})

test('interval fires every N days from the start date', () => {
  const schedule: Schedule = { kind: 'interval', timesOfDay: ['12:00'], everyNDays: 3 }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-06-10T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-01 12:00', '2026-06-04 12:00', '2026-06-07 12:00'])
})

test('once fires a single time on the start date and never again', () => {
  const schedule: Schedule = { kind: 'once', timesOfDay: ['15:45'] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-02',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-06-30T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-02 15:45'])
})

test('once whose time already passed is included when the window reaches back to it', () => {
  // Mirrors how materializeReminder back-fills a one-shot: with `from` set before
  // the (already-past) instant, expansion still returns it so the tick can fire it.
  const schedule: Schedule = { kind: 'once', timesOfDay: ['09:00'] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-02',
    endDate: null,
    timeZone: TZ,
    // "now" is 09:05, five minutes after the instant; the back-reaching `from` keeps it.
    ...window('2026-06-01T09:05', '2026-06-04T09:05')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-02 09:00'])
})

test('once strictly before the window lower bound is dropped', () => {
  const schedule: Schedule = { kind: 'once', timesOfDay: ['09:00'] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-02',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-02T09:01', '2026-06-04T09:01')
  })
  assert.deepEqual(localTimes(dates), [])
})

test('multiple times-of-day expand per active day', () => {
  const schedule: Schedule = { kind: 'daily', timesOfDay: ['08:00', '20:00'] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-01',
    endDate: '2026-06-01',
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-06-02T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-01 08:00', '2026-06-01 20:00'])
})

test('spring-forward DST day keeps the wall-clock time', () => {
  // DST begins 2026-03-08 in Toronto (clocks jump 02:00 -> 03:00).
  const schedule: Schedule = { kind: 'daily', timesOfDay: ['09:00'] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-03-07',
    endDate: null,
    timeZone: TZ,
    ...window('2026-03-07T00:00', '2026-03-10T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-03-07 09:00', '2026-03-08 09:00', '2026-03-09 09:00'])
})

// --- Monthly -----------------------------------------------------------------

test('monthly fires on the named day of each month', () => {
  const schedule: Schedule = { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-15',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-15T00:00', '2026-09-02T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-07-01 09:00', '2026-08-01 09:00', '2026-09-01 09:00'])
})

test('monthly honors several days of the month', () => {
  const schedule: Schedule = { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1, 15] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-07-02T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-01 09:00', '2026-06-15 09:00', '2026-07-01 09:00'])
})

test('a day the month does not have is skipped, never clamped back onto the last day', () => {
  // "The 31st" means the 31st. February has none, so February simply doesn't fire
  // — clamping onto the 28th would ring on a day the user never picked.
  const schedule: Schedule = { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [31] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-01-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-01-01T00:00', '2026-04-01T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-01-31 09:00', '2026-03-31 09:00'])
})

test("lastDayOfMonth tracks each month's real length", () => {
  const schedule: Schedule = { kind: 'monthly', timesOfDay: ['18:00'], lastDayOfMonth: true }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-01-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-01-01T00:00', '2026-05-01T00:00')
  })
  assert.deepEqual(localTimes(dates), [
    '2026-01-31 18:00',
    '2026-02-28 18:00',
    '2026-03-31 18:00',
    '2026-04-30 18:00'
  ])
})

test('lastDayOfMonth is additive with named days and never double-fires', () => {
  // The 30th IS April's last day — the two rules coincide and must yield one firing.
  const schedule: Schedule = { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [30], lastDayOfMonth: true }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-04-01',
    endDate: null,
    timeZone: TZ,
    ...window('2026-04-01T00:00', '2026-05-01T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-04-30 09:00'])
})

test('monthly respects the end date', () => {
  const schedule: Schedule = { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1] }
  const dates = expandSchedule({
    schedule,
    startDate: '2026-06-01',
    endDate: '2026-07-15',
    timeZone: TZ,
    ...window('2026-06-01T00:00', '2026-09-01T00:00')
  })
  assert.deepEqual(localTimes(dates), ['2026-06-01 09:00', '2026-07-01 09:00'])
})
