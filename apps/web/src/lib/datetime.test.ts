import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDateTime, formatWhen } from './datetime.js'

test('one shared instant displays in each account time zone', () => {
  const instant = '2027-03-15T13:00:00.000Z'
  assert.match(formatDateTime(instant, '24h', 'America/Toronto'), /09:00/)
  assert.match(formatDateTime(instant, '24h', 'Europe/London'), /13:00/)
  assert.match(formatWhen(instant, '24h', 'America/Toronto'), /09:00/)
  assert.match(formatWhen(instant, '24h', 'Europe/London'), /13:00/)
})

test('date label follows the requested zone across a day boundary', () => {
  const instant = '2027-03-15T23:30:00.000Z'
  assert.match(formatDateTime(instant, '24h', 'America/Toronto'), /Mar 15/)
  assert.match(formatDateTime(instant, '24h', 'Europe/London'), /Mar 15/)
  assert.match(formatDateTime(instant, '24h', 'Asia/Tokyo'), /Mar 16/)
  const now = new Date('2027-03-15T14:00:00.000Z')
  assert.match(formatWhen(instant, '24h', 'America/Toronto', now), /^Today/)
  assert.match(formatWhen(instant, '24h', 'Asia/Tokyo', now), /^Tomorrow/)
})
