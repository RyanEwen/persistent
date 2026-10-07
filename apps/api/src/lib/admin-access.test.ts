/** Admin designation is exact; runtime access must use the stored role rather than an email heuristic. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
const { initialAdminGrant, requireAdmin } = await import('./admin-access.js')

test('only the verified bootstrap address receives an initial grant', () => {
  assert.equal(initialAdminGrant('Ryan.Ewen@gmail.com'), true)
  for (const email of ['other@example.com', 'ryan.ewen+admin@gmail.com', 'ryan.ewen@gmail.com.example.org']) {
    assert.equal(initialAdminGrant(email), false)
  }
})

test('anonymous access is rejected before the database lookup', async () => {
  await assert.rejects(requireAdmin({} as never), { statusCode: 401 })
})
