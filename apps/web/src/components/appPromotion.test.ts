import assert from 'node:assert/strict'
import test from 'node:test'
import { getNativeAppsPromotion, PLAY_STORE_URL, WINDOWS_STORE_URL } from './appPromotion.js'

test('uses the published Store listings', () => {
  assert.equal(PLAY_STORE_URL, 'https://play.google.com/store/apps/details?id=ca.dynamicsolutions.persistent')
  assert.equal(WINDOWS_STORE_URL, 'https://apps.microsoft.com/detail/9PCX2XGQ7CJS')
})

test('promotes Windows without redundantly promoting Android inside Android', () => {
  const promotion = getNativeAppsPromotion('android')
  assert.equal(promotion.showAndroid, false)
  assert.equal(promotion.showWindows, true)
})

test('promotes Android without redundantly promoting Windows inside Windows', () => {
  const promotion = getNativeAppsPromotion('windows')
  assert.equal(promotion.showAndroid, true)
  assert.equal(promotion.showWindows, false)
})

test('promotes both native apps in an ordinary browser', () => {
  const promotion = getNativeAppsPromotion('web')
  assert.equal(promotion.showAndroid, true)
  assert.equal(promotion.showWindows, true)
})
