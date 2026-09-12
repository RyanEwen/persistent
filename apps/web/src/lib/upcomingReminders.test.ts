import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Reminder } from '@persistent/shared'
import { selectUpcomingReminders } from './upcomingReminders.js'

const NOW = new Date(2026, 8, 12, 9, 0)

/** Build only the Reminder fields this pure selector reads. */
function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    active: true,
    startDate: '2026-09-12',
    endDate: null,
    schedule: { kind: 'once', timesOfDay: ['12:00'] },
    lastOccurrence: null,
    ...overrides
  } as Reminder
}

test('upcoming excludes notes, completed one-shots and reminders active on Current', () => {
  const visible = reminder('visible')
  const note = reminder('note', { schedule: { kind: 'never', timesOfDay: [] } })
  const finished = reminder('finished', {
    lastOccurrence: { status: 'ACKNOWLEDGED', scheduledFor: '2026-09-11T12:00:00.000Z' }
  })
  const active = reminder('active')

  assert.deepEqual(
    selectUpcomingReminders([visible, note, finished, active], [{ reminderId: active.id }], NOW).map(
      ({ reminder: selected }) => selected.id
    ),
    ['visible']
  )
})

test('upcoming sorts by next fire and leaves paused reminders last', () => {
  const later = reminder('later', { schedule: { kind: 'once', timesOfDay: ['17:00'] } })
  const sooner = reminder('sooner', { schedule: { kind: 'once', timesOfDay: ['10:00'] } })
  const paused = reminder('paused', { active: false })

  assert.deepEqual(
    selectUpcomingReminders([later, paused, sooner], [], NOW).map(({ reminder: selected }) => selected.id),
    ['sooner', 'later', 'paused']
  )
})
