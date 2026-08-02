import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parentRoute } from './useNativeBack.js'

// The hierarchy Back walks. This is the whole reason Back stopped following
// browser history: these answers must hold no matter which route you came from.

test('a tab root has nothing above it', () => {
  // Every bottom-nav destination, including Upcoming: a tab missing from
  // TAB_ROUTES is silently treated as a child screen, so Back would go to the
  // list from it instead of leaving the app.
  for (const tab of ['/', '/upcoming', '/history', '/settings']) {
    assert.equal(parentRoute(tab), null, `${tab} should be a root`)
  }
})

test('the editor goes up to the reminder it edits, not to the list', () => {
  assert.equal(parentRoute('/reminders/abc123/edit'), '/reminders/abc123')
})

test('a reminder goes up to the list', () => {
  assert.equal(parentRoute('/reminders/abc123'), '/')
})

test('the new-reminder form goes up to the list', () => {
  assert.equal(parentRoute('/reminders/new'), '/')
})

test('screens opened from Settings go back to Settings', () => {
  // Reached only from the Settings page, so returning to the reminders list would
  // strand the user somewhere they never came from.
  for (const child of ['/help', '/privacy', '/delete-account']) {
    assert.equal(parentRoute(child), '/settings', `${child} should return to Settings`)
  }
})

test('an unknown screen falls back to the list rather than trapping the user', () => {
  assert.equal(parentRoute('/something-new'), '/')
})

test('a reminder id containing "edit" is not mistaken for the editor', () => {
  // The editor is matched by path shape, not by substring.
  assert.equal(parentRoute('/reminders/edit'), '/')
  assert.equal(parentRoute('/reminders/edited123'), '/')
})
