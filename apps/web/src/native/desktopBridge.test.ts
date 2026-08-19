/**
 * `parseHostSettings` is what stands between a native process and the Settings
 * screen, and that process may be an older build than this bundle. Two rules to
 * hold onto: a payload is accepted whole or not at all (null is what hides the
 * section on an older host), but a value that is merely off one of the offered
 * lists is snapped rather than rejected, because a blank picker is worse than an
 * approximate one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHostSettings } from './desktopBridge.js'

const complete = {
  notifications: true,
  snoozeMinutes: 15,
  snoozeChoices: [
    { minutes: 5, label: '5 min' },
    { minutes: 15, label: '15 min' },
    { minutes: 60, label: '1 hr' }
  ],
  pinFlyout: false,
  startAtSignIn: true,
  flyoutSize: 'standard',
  flyoutSizes: [
    { id: 'compact', label: 'Compact', width: 380, height: 560 },
    { id: 'standard', label: 'Standard', width: 420, height: 680 }
  ]
}

test('parseHostSettings: accepts a complete payload', () => {
  assert.deepEqual(parseHostSettings(complete), complete)
})

test('parseHostSettings: ignores fields a newer host adds', () => {
  assert.deepEqual(parseHostSettings({ ...complete, somethingNew: 'ignored' }), complete)
})

test('parseHostSettings: rejects a payload missing any field', () => {
  for (const field of Object.keys(complete)) {
    const partial: Record<string, unknown> = { ...complete }
    delete partial[field]
    assert.equal(parseHostSettings(partial), null, `expected null without ${field}`)
  }
})

test('parseHostSettings: rejects a field of the wrong type', () => {
  assert.equal(parseHostSettings({ ...complete, snoozeMinutes: '15' }), null)
  assert.equal(parseHostSettings({ ...complete, notifications: 1 }), null)
  assert.equal(parseHostSettings({ ...complete, pinFlyout: 'true' }), null)
  assert.equal(parseHostSettings({ ...complete, startAtSignIn: null }), null)
  assert.equal(parseHostSettings({ ...complete, flyoutSize: 42 }), null)
})

test('parseHostSettings: rejects a payload with no usable options, since a picker would be empty', () => {
  assert.equal(parseHostSettings({ ...complete, flyoutSizes: [] }), null)
  assert.equal(parseHostSettings({ ...complete, flyoutSizes: 'standard' }), null)
  assert.equal(parseHostSettings({ ...complete, flyoutSizes: [{ id: 'standard' }] }), null)
  assert.equal(parseHostSettings({ ...complete, snoozeChoices: [] }), null)
  assert.equal(parseHostSettings({ ...complete, snoozeChoices: [{ minutes: 5 }] }), null)
})

test('parseHostSettings: drops a malformed option but keeps the rest', () => {
  const mixed = { ...complete, flyoutSizes: [...complete.flyoutSizes, { id: 'tall' }] }
  assert.deepEqual(parseHostSettings(mixed)?.flyoutSizes, complete.flyoutSizes)
})

test('parseHostSettings: drops a duplicate option, which would collide as a React key', () => {
  const dupes = {
    ...complete,
    flyoutSizes: [...complete.flyoutSizes, { id: 'standard', label: 'Standard again', width: 1, height: 2 }],
    snoozeChoices: [...complete.snoozeChoices, { minutes: 15, label: '15 min again' }]
  }
  const parsed = parseHostSettings(dupes)
  assert.deepEqual(parsed?.flyoutSizes, complete.flyoutSizes)
  assert.deepEqual(parsed?.snoozeChoices, complete.snoozeChoices)
})

test('parseHostSettings: snaps a snooze the host cannot offer to the nearest it can', () => {
  // 10 sits between the offered 5 and 15. The Windows toast resolves it the same
  // way (ToastNotifier.NearestOffered), and both keep the first on a tie.
  assert.equal(parseHostSettings({ ...complete, snoozeMinutes: 10 })?.snoozeMinutes, 5)
  assert.equal(parseHostSettings({ ...complete, snoozeMinutes: 180 })?.snoozeMinutes, 60)
  assert.equal(parseHostSettings({ ...complete, snoozeMinutes: 0 })?.snoozeMinutes, 5)
})

test('parseHostSettings: falls back to the first size when the current one is not on offer', () => {
  assert.equal(parseHostSettings({ ...complete, flyoutSize: 'enormous' })?.flyoutSize, 'compact')
})

test('parseHostSettings: rejects anything that is not an object', () => {
  assert.equal(parseHostSettings(null), null)
  assert.equal(parseHostSettings(undefined), null)
  assert.equal(parseHostSettings('hostSettings'), null)
  assert.equal(parseHostSettings([complete]), null)
})
