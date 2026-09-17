/**
 * Protect the shipped association document for both Android distributions.
 * Bitwarden checks handle_all_urls for native passkeys, while other providers
 * use get_login_creds. A valid JSON document with only one can still fail login.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

interface AssetLinkStatement {
  relation: string[]
  target: {
    namespace: string
    package_name: string
    sha256_cert_fingerprints: string[]
  }
}

const statements = JSON.parse(readFileSync(
  new URL('../../apps/web/public/.well-known/assetlinks.json', import.meta.url),
  'utf8'
)) as AssetLinkStatement[]

test('both Android distributions have explicit signed app associations', () => {
  assert.deepEqual(statements.map(({ target }) => target.package_name).sort(), [
    'ca.dynamicsolutions.persistent',
    'ca.persistent.app'
  ])
  for (const { target } of statements) {
    assert.equal(target.namespace, 'android_app')
    assert.ok(target.sha256_cert_fingerprints.length > 0)
    for (const fingerprint of target.sha256_cert_fingerprints) {
      assert.match(fingerprint, /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/)
    }
  }
})

test('every distribution supports Bitwarden and credential-sharing association checks', () => {
  for (const { relation, target } of statements) {
    assert.ok(relation.includes('delegate_permission/common.get_login_creds'), target.package_name)
    assert.ok(relation.includes('delegate_permission/common.handle_all_urls'), target.package_name)
  }
})
