import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firesRightAway, fireSummary, type SchedulePreviewInput } from './schedule-preview.js'

// Fixed "now" with seconds past the minute — the real trigger: a new reminder's
// default time is the current minute (HH:mm), so by save it has just slipped past.
const NOW = new Date(2026, 6, 1, 12, 0, 30) // Jul 1 2026, 12:00:30 local

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function input(overrides: Partial<SchedulePreviewInput>): SchedulePreviewInput {
  return {
    kind: 'once',
    timesOfDay: ['12:00'],
    daysOfWeek: [],
    daysOfMonth: [],
    lastDayOfMonth: false,
    everyNDays: 1,
    skipWeekends: false,
    startDate: ymd(NOW),
    endDate: '',
    ...overrides
  }
}

test('a just-passed one-shot (default time, saved a moment later) fires right away', () => {
  assert.equal(firesRightAway(input({}), NOW), true)
  assert.equal(fireSummary(input({}), '24h', NOW), 'Fires right away')
})

test('a future one-shot shows its upcoming time, not "right away"', () => {
  const future = input({ timesOfDay: ['13:00'] })
  assert.equal(firesRightAway(future, NOW), false)
  assert.match(fireSummary(future, '24h', NOW) ?? '', /^Fires today/)
})

test('a one-shot older than the 48h back-fill window has no upcoming fire', () => {
  const stale = input({ startDate: ymd(new Date(NOW.getTime() - 3 * 86_400_000)) })
  assert.equal(firesRightAway(stale, NOW), false)
  assert.equal(fireSummary(stale, '24h', NOW), null)
})

test('a repeating schedule is never "right away" for a passed time (server does not back-fill it)', () => {
  const daily = input({ kind: 'daily', timesOfDay: ['06:00'] })
  assert.equal(firesRightAway(daily, NOW), false)
  // It rolls to the next day rather than firing now.
  assert.match(fireSummary(daily, '24h', NOW) ?? '', /^Fires tomorrow/)
})

test('no time set is genuinely no upcoming fire', () => {
  const noTime = input({ timesOfDay: [] })
  assert.equal(firesRightAway(noTime, NOW), false)
  assert.equal(fireSummary(noTime, '24h', NOW), null)
})

// --- Monthly: the preview must agree with the server's expansion --------------

test("monthly on the 1st rolls to next month once this month's day has passed", () => {
  // NOW is Jul 1 12:00:30, so today's 09:00 firing is already behind us.
  const monthly = input({ kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1] })
  assert.match(fireSummary(monthly, '24h', NOW) ?? '', /^Fires on Aug 1/)
})

test('monthly picks the soonest of several days of the month', () => {
  const monthly = input({ kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1, 15] })
  assert.match(fireSummary(monthly, '24h', NOW) ?? '', /^Fires on Jul 15/)
})

test('a day the month lacks is skipped, matching the server (never clamped)', () => {
  // September has no 31st, so a "31st" reminder next fires in October.
  const monthly = input({
    kind: 'monthly',
    timesOfDay: ['09:00'],
    daysOfMonth: [31],
    startDate: '2026-09-01',
    endDate: ''
  })
  assert.match(fireSummary(monthly, '24h', new Date(2026, 8, 1, 12, 0)) ?? '', /^Fires on Oct 31/)
})

test("lastDayOfMonth resolves to the month's real final day", () => {
  const monthly = input({ kind: 'monthly', timesOfDay: ['09:00'], lastDayOfMonth: true })
  assert.match(fireSummary(monthly, '24h', NOW) ?? '', /^Fires on Jul 31/)
})
