import assert from 'node:assert/strict'
import test from 'node:test'
import { pushConfigSchema, registerSubscriptionSchema } from './push.js'

test('accepts native FCM registrations', () => {
  assert.equal(registerSubscriptionSchema.safeParse({ kind: 'FCM', token: 'device-token' }).success, true)
})

test('rejects retired browser push registrations', () => {
  assert.equal(
    registerSubscriptionSchema.safeParse({
      kind: 'WEB',
      subscription: { endpoint: 'https://push.example.test', keys: { p256dh: 'key', auth: 'auth' } }
    }).success,
    false
  )
})

test('publishes only native push configuration', () => {
  const result = pushConfigSchema.parse({ fcmEnabled: true })
  assert.deepEqual(result, { fcmEnabled: true })
})
