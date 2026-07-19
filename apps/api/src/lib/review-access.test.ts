import test from 'node:test'
import assert from 'node:assert/strict'

// review-access reads env at import time via lib/env, so configure before importing.
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
process.env.REVIEW_ACCOUNT_EMAIL = 'store-review@example.com'
process.env.REVIEW_ACCOUNT_CODE = 'review-code-1234567890'

const { isReviewAccount, isReviewLogin, reviewAccessEnabled } = await import('./review-access.js')

test('review access is enabled when both vars are set', () => {
  assert.equal(reviewAccessEnabled(), true)
})

test('the designated account is recognised, case- and space-insensitively', () => {
  assert.equal(isReviewAccount('store-review@example.com'), true)
  assert.equal(isReviewAccount('  Store-Review@Example.com  '), true)
})

test('any other account is not the review account', () => {
  assert.equal(isReviewAccount('someone@example.com'), false)
})

test('the correct email + code signs in', () => {
  assert.equal(isReviewLogin('store-review@example.com', 'review-code-1234567890'), true)
})

test('a wrong code is rejected', () => {
  assert.equal(isReviewLogin('store-review@example.com', 'review-code-0000000000'), false)
})

test('a code of a different length is rejected without throwing', () => {
  // timingSafeEqual throws on unequal buffer lengths; the guard must catch that.
  assert.equal(isReviewLogin('store-review@example.com', 'short'), false)
})

test('the review code does not work for any other account', () => {
  // The whole point: this is one account's bypass, not a master key.
  assert.equal(isReviewLogin('someone@example.com', 'review-code-1234567890'), false)
})
