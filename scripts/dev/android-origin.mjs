#!/usr/bin/env node
/**
 * Convert an Android signing-certificate SHA-256 fingerprint into the two forms
 * passkeys need:
 *
 *   - the `android:apk-key-hash:<base64url>` origin for ANDROID_APP_ORIGIN
 *   - the colon-separated hex for assetlinks.json's sha256_cert_fingerprints
 *
 * You need this whenever the app gains a signing certificate — most importantly
 * after enrolling in Play App Signing, where Play re-signs the app with its own
 * key and the Play build therefore reports a *different* origin than the
 * sideloaded build. Both must be accepted or passkeys break on one of them.
 *
 * Where to find the fingerprint:
 *   Play Console -> your app -> Test and release -> Setup -> App integrity
 *     "App signing key certificate"  -> the key Play re-signs with (Play builds)
 *     "Upload key certificate"       -> your release.keystore (sideloaded builds)
 *   Local keystore:
 *     keytool -list -v -keystore release.keystore -alias <alias> | grep SHA256
 *
 * Usage:
 *   npm run android:origin -- AA:BB:CC:...          (colons optional)
 */
const input = process.argv[2]
if (!input) {
  console.error('Usage: npm run android:origin -- <SHA-256 fingerprint>')
  process.exit(1)
}

const hex = input.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
if (hex.length !== 64) {
  console.error(`Expected a SHA-256 fingerprint (64 hex chars); got ${hex.length} after stripping separators.`)
  process.exit(1)
}

const bytes = Buffer.from(hex, 'hex')
const base64url = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const colonHex = (hex.match(/../g) ?? []).join(':').toUpperCase()

console.log(`
apk-key-hash origin  (apps/api/src/lib/webauthn.ts / ANDROID_APP_ORIGIN):
  android:apk-key-hash:${base64url}

assetlinks fingerprint  (apps/web/public/.well-known/assetlinks.json):
  ${colonHex}

Both lists accept multiple certificates — add, don't replace, or you break
passkeys on whichever build you dropped.
`)
