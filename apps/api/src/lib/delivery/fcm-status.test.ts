import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFcmStatus } from './fcm-status.js'

test('2xx is delivered', () => {
  assert.equal(classifyFcmStatus(200), 'ok')
  assert.equal(classifyFcmStatus(204), 'ok')
})

test('401 means our OAuth token was rejected — refresh, never prune', () => {
  // Regression: a stale cached service-account token returned 401 on every send
  // and the device token was (correctly) kept; the fix retries with a fresh token.
  assert.equal(classifyFcmStatus(401), 'authRefresh')
})

test('403/404 mean the device token is dead — prune it', () => {
  assert.equal(classifyFcmStatus(403), 'prune')
  assert.equal(classifyFcmStatus(404), 'prune')
})

test('other errors are transient failures, not prunable', () => {
  assert.equal(classifyFcmStatus(429), 'fail')
  assert.equal(classifyFcmStatus(500), 'fail')
  assert.equal(classifyFcmStatus(0), 'fail')
})
