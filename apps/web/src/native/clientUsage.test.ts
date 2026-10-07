import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyClient, collectClientUsage } from './clientUsage.js'
import { clientUsageSchema } from '@persistent/shared'

test('native bridges take precedence over WebView user agents and display mode', () => {
  assert.deepEqual(classifyClient(true, false, false, 'Linux'), { app: 'android', platform: 'android' })
  assert.deepEqual(classifyClient(false, true, true, 'Chrome Windows'), { app: 'windows', platform: 'windows' })
})

test('browser and PWA modes stay distinct and unsupported platforms stay unknown', () => {
  assert.deepEqual(classifyClient(false, false, true, 'Android Linux'), { app: 'pwa', platform: 'android' })
  assert.deepEqual(classifyClient(false, false, false, 'iPhone Mac OS X'), { app: 'browser', platform: 'ios' })
  assert.deepEqual(classifyClient(false, false, false, 'Macintosh'), { app: 'browser', platform: 'macos' })
  assert.deepEqual(classifyClient(false, false, false, 'Unrecognized'), { app: 'browser', platform: 'unknown' })
})

test('client identity bounds versions and rejects role/owner injection', () => {
  const input = { app: 'browser', platform: 'windows', webVersion: '1.0.0', nativeVersion: null }
  assert.equal(clientUsageSchema.safeParse(input).success, true)
  assert.equal(clientUsageSchema.safeParse({ ...input, userId: 'someone-else' }).success, false)
  assert.equal(clientUsageSchema.safeParse({ ...input, isAdmin: true }).success, false)
  assert.equal(clientUsageSchema.safeParse({ ...input, webVersion: 'x'.repeat(65) }).success, false)
  assert.equal(clientUsageSchema.safeParse({ ...input, app: 'made-up' }).success, false)
})


test('a delayed native version cannot report after its account was replaced', async () => {
  const controller = new AbortController()
  let resolve!: (info: { version: string }) => void
  const info = new Promise<{ version: string }>((done) => { resolve = done })
  const pending = collectClientUsage({ app: 'android', platform: 'android' }, '1.0.0', () => info, controller.signal)
  controller.abort()
  resolve({ version: '2.0.0' })
  await assert.rejects(pending, { name: 'AbortError' })
})

test('non-native sessions never invoke the native version bridge', async () => {
  const usage = await collectClientUsage({ app: 'pwa', platform: 'windows' }, '1.0.0', async () => {
    throw new Error('Native lookup must not run')
  })
  assert.deepEqual(usage, { app: 'pwa', platform: 'windows', webVersion: '1.0.0', nativeVersion: null })
})
