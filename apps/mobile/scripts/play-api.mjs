/** Shared, dependency-free service-account authentication and transport for Play tooling. */
import { createSign } from 'node:crypto'

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

/** Parse the configured service-account key without including credential contents in failures. */
export function readPlayServiceAccount(rawKey) {
  if (!rawKey) throw new Error('PLAY_SERVICE_ACCOUNT_JSON is not set.')
  let account
  try {
    account = JSON.parse(rawKey)
  } catch {
    throw new Error('PLAY_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the key file whole, not base64-encoded.')
  }
  if (!account?.client_email || !account?.private_key) {
    throw new Error('PLAY_SERVICE_ACCOUNT_JSON is missing client_email/private_key.')
  }
  return account
}

/** Report transport failures by operation; never print request bodies or authorization headers. */
export async function playRequest(url, init, operation) {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw new Error(`Could not reach ${operation}: ${error?.cause?.message || error?.message || error}`)
  }
}

/** Exchange a signed service-account JWT for an androidpublisher-scoped access token. */
export async function getPlayAccessToken(account) {
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  })).toString('base64url')
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key).toString('base64url')
  const response = await playRequest(tokenUri, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`
    })
  }, 'the Google OAuth token endpoint')
  if (!response.ok) throw new Error(`Could not get an access token (HTTP ${response.status}).`)
  const body = await response.json()
  if (!body.access_token) throw new Error('Token response had no access_token.')
  return body.access_token
}
