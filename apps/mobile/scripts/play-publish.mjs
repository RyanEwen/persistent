#!/usr/bin/env node
/**
 * Publish one AAB to one or more Google Play tracks, and pre-flight the things
 * that otherwise only fail after a full CI build.
 *
 * Why this exists rather than an off-the-shelf publish action: a release must
 * land on `internal` **and** `alpha` with the *same* build, and Play rejects a
 * second upload of a versionCode it already has. So both tracks have to be
 * assigned inside a single edit — upload once, attach that versionCode to every
 * track, commit once. Two sequential single-track uploads cannot do that.
 *
 * Auth is a Play Developer service account: PLAY_SERVICE_ACCOUNT_JSON holds the
 * key file's contents verbatim (not base64), matching the GitHub secret. No
 * dependencies — Node 20 has fetch and RS256 signing built in.
 *
 * Modes:
 *   --check         Report each track's releases and the highest versionCode in
 *                   use, then exit. With --version-code, exits non-zero when
 *                   that code is not strictly higher than everything on Play —
 *                   the one Play failure worth catching *before* a 4-minute
 *                   build, since the code is baked in at assemble time.
 *   (default)       Upload --aab and release it to --tracks.
 *
 * Usage:
 *   node scripts/play-publish.mjs --check --version-code 40
 *   node scripts/play-publish.mjs --aab app.aab --tracks internal,alpha \
 *     --version-name 0.17.0 --notes RELEASE_NOTES.md [--status completed|draft]
 */
import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

// PLAY_API_BASE is a test seam: play-publish.test.ts points it at a local mock
// to assert the request sequence (one edit, one upload, every track). Never set
// it in CI.
const API = process.env.PLAY_API_BASE || 'https://androidpublisher.googleapis.com'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const DEFAULT_PACKAGE = 'ca.dynamicsolutions.persistent'

/** Play hard-caps a release note at 500 characters and rejects an empty one. */
const NOTE_LIMIT = 500
const NOTE_FALLBACK = 'Bug fixes and improvements.'
const NOTE_LANGUAGE = 'en-US'

function fail(message) {
  console.error(`\n[play-publish] ${message}\n`)
  process.exit(1)
}

function read(path, what, encoding) {
  try {
    return readFileSync(path, encoding)
  } catch (error) {
    return fail(`Could not read the ${what} at ${path}: ${error?.message || error}`)
  }
}

// --- pure helpers (unit-tested in play-publish.test.ts) ----------------------

/** Minimal `--flag value` / `--flag` parser. Returns a plain object of strings/true. */
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

/** `"internal, alpha"` -> `['internal', 'alpha']`, deduped, order preserved. */
export function parseTracks(value) {
  const tracks = String(value ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return [...new Set(tracks)]
}

/**
 * Turn the GitHub release notes into Play's "what's new" text.
 *
 * The same notes feed the in-app update prompt, where the markdown heading and
 * the compare link are useful; on Play they are noise inside a 500-character
 * budget. Truncation is on a line boundary so a release never ships a note that
 * stops mid-sentence.
 */
export function playNotesFrom(markdown, limit = NOTE_LIMIT) {
  const lines = String(markdown ?? '')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !line.startsWith('**Full changelog**'))
    .map((line) => line.trimEnd())

  // Drop leading/trailing blank lines left behind by the filters.
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()

  const kept = []
  let length = 0
  for (const line of lines) {
    const cost = length === 0 ? line.length : line.length + 1
    if (length + cost > limit) break
    kept.push(line)
    length += cost
  }

  if (kept.length) return kept.join('\n')
  // A single opening line longer than the whole budget: keep as much as fits
  // rather than discarding real notes for the generic fallback.
  const first = lines[0]?.trim()
  if (first) return `${first.slice(0, limit - 1)}…`
  return NOTE_FALLBACK
}

/** Highest versionCode across every release of every track, or 0 if none. */
export function highestVersionCode(tracks) {
  let highest = 0
  for (const track of tracks ?? []) {
    for (const release of track.releases ?? []) {
      for (const code of release.versionCodes ?? []) {
        const value = Number(code)
        if (Number.isFinite(value) && value > highest) highest = value
      }
    }
  }
  return highest
}

/** One `track: versionCodes (status)` line per release, for the CI log. */
export function describeTracks(tracks) {
  if (!tracks?.length) return '  (no tracks have releases yet)'
  return tracks
    .map((track) => {
      const releases = (track.releases ?? []).map(
        (r) => `${(r.versionCodes ?? ['-']).join(', ')} (${r.status ?? 'unknown'})`
      )
      return `  ${track.track}: ${releases.length ? releases.join(' | ') : '(empty)'}`
    })
    .join('\n')
}

// --- Play API ---------------------------------------------------------------

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

/**
 * fetch that reports a transport failure as a sentence instead of an undici
 * stack — this runs unattended in CI, where the log is the only diagnosis.
 */
async function request(url, init, what) {
  try {
    return await fetch(url, init)
  } catch (error) {
    fail(`Could not reach ${what} (${url}): ${error?.cause?.message || error?.message || error}`)
  }
}

/** Service-account JWT -> OAuth access token. */
async function getAccessToken(serviceAccount) {
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600
    })
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(serviceAccount.private_key)
  const assertion = `${header}.${claims}.${base64url(signature)}`

  const response = await request(
    tokenUri,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    },
    'the Google OAuth token endpoint'
  )
  const body = await response.text()
  if (!response.ok) fail(`Could not get an access token (HTTP ${response.status}): ${body}`)
  const token = JSON.parse(body).access_token
  if (!token) fail(`Token response had no access_token: ${body}`)
  return token
}

/**
 * Play API request. `raw` sends a Buffer as octet-stream (bundle upload);
 * otherwise the body is JSON. Returns the parsed response, or the error text
 * when `tolerate` matches so the caller can react to a specific failure.
 */
async function playFetch(token, path, { method = 'GET', body, raw, tolerate } = {}) {
  const headers = { Authorization: `Bearer ${token}` }
  let payload
  if (raw) {
    // Content-Length is left to undici — it derives it from the buffer, and
    // setting it here risks a duplicate/conflicting header.
    headers['Content-Type'] = 'application/octet-stream'
    payload = raw
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await request(`${API}${path}`, { method, headers, body: payload }, 'the Play Developer API')
  const text = await response.text()
  if (!response.ok) {
    if (tolerate && text.includes(tolerate)) return { error: text }
    fail(`${method} ${path} failed (HTTP ${response.status}): ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

const editsPath = (pkg, editId = '') => `/androidpublisher/v3/applications/${pkg}/edits${editId ? `/${editId}` : ''}`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const packageName = args['package'] || DEFAULT_PACKAGE

  // Validate the invocation before authenticating: a missing flag should fail
  // instantly and unmistakably, not after a token round-trip.
  const publishing = !args.check
  const aab = args.aab
  const tracks = parseTracks(args.tracks)
  const versionName = args['version-name']
  const status = args.status || 'completed'
  if (publishing) {
    if (!aab) fail('--aab <path> is required.')
    if (!tracks.length) fail('--tracks <internal[,alpha,...]> is required.')
    if (!versionName) fail('--version-name <x.y.z> is required.')
    if (!['completed', 'draft'].includes(status)) {
      fail(`--status must be 'completed' or 'draft', got '${status}'.`)
    }
  }
  // Read the AAB and notes up front too — a bad path is a caller error, and
  // finding it now avoids leaving an uncommitted edit behind on Play.
  const notes = publishing && args.notes ? playNotesFrom(read(args.notes, 'notes', 'utf8')) : NOTE_FALLBACK
  const bundle = publishing ? read(aab, 'AAB') : null

  const rawKey = process.env.PLAY_SERVICE_ACCOUNT_JSON
  if (!rawKey) fail('PLAY_SERVICE_ACCOUNT_JSON is not set.')
  let serviceAccount
  try {
    serviceAccount = JSON.parse(rawKey)
  } catch {
    fail('PLAY_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the key file whole, not base64-encoded.')
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    fail('PLAY_SERVICE_ACCOUNT_JSON is missing client_email/private_key — is it a service-account key?')
  }

  const token = await getAccessToken(serviceAccount)
  console.log(`[play-publish] authenticated as ${serviceAccount.client_email}`)
  console.log(`[play-publish] package ${packageName}`)

  // --- --check: report state, verify the versionCode can still be used ------
  if (args.check) {
    const edit = await playFetch(token, editsPath(packageName), { method: 'POST', body: {} })
    const { tracks } = await playFetch(token, `${editsPath(packageName, edit.id)}/tracks`)
    console.log('[play-publish] current Play tracks:')
    console.log(describeTracks(tracks))
    const highest = highestVersionCode(tracks)
    console.log(`[play-publish] highest versionCode on Play: ${highest || '(none)'}`)
    // Read-only probe: drop the edit so it can't linger and block later edits.
    await playFetch(token, editsPath(packageName, edit.id), { method: 'DELETE' })

    const intended = Number(args['version-code'])
    if (Number.isFinite(intended) && intended > 0) {
      console.log(`[play-publish] this build would upload versionCode ${intended}`)
      if (intended <= highest) {
        fail(
          `versionCode ${intended} is not higher than ${highest}, which Play already has.\n` +
            'Play requires a strictly increasing, never-reused code, so this build would be\n' +
            'rejected after the Android build finishes.\n\n' +
            `Fix: set the repo variable PLAY_VERSION_CODE_OFFSET to at least ${highest - intended + 1}\n` +
            '(gh variable set PLAY_VERSION_CODE_OFFSET --body "<n>"). It is added to the workflow\n' +
            'run number, so every later run stays above Play as well.'
        )
      }
    }
    return
  }

  // --- publish -------------------------------------------------------------
  const edit = await playFetch(token, editsPath(packageName), { method: 'POST', body: {} })
  console.log(`[play-publish] edit ${edit.id} created`)

  const uploaded = await playFetch(
    token,
    `/upload${editsPath(packageName, edit.id)}/bundles?uploadType=media`,
    { method: 'POST', raw: bundle }
  )
  const versionCode = uploaded.versionCode
  console.log(`[play-publish] uploaded ${aab} (${(bundle.length / 1e6).toFixed(1)} MB) as versionCode ${versionCode}`)

  // Same versionCode onto every track, inside this one edit — the whole reason
  // this script exists instead of one upload action per track.
  for (const track of tracks) {
    await playFetch(token, `${editsPath(packageName, edit.id)}/tracks/${track}`, {
      method: 'PUT',
      body: {
        track,
        releases: [
          {
            name: versionName,
            versionCodes: [String(versionCode)],
            status,
            releaseNotes: [{ language: NOTE_LANGUAGE, text: notes }]
          }
        ]
      }
    })
    console.log(`[play-publish] track ${track} <- versionCode ${versionCode} (${status})`)
  }

  const commitPath = `${editsPath(packageName, edit.id)}:commit`
  const committed = await playFetch(token, commitPath, {
    method: 'POST',
    tolerate: 'changesNotSentForReview'
  })
  if (committed.error) {
    // Play refuses to auto-submit for review while the app has changes pending
    // review. The release itself is still valid; it just has to be committed
    // without a review submission.
    console.log('[play-publish] Play declined to auto-submit for review; committing with changesNotSentForReview=true')
    await playFetch(token, `${commitPath}?changesNotSentForReview=true`, { method: 'POST' })
  }

  console.log(`[play-publish] committed. ${versionName} (versionCode ${versionCode}) -> ${tracks.join(', ')}`)
  console.log('--- what\'s new ---')
  console.log(notes)
}

// Importable for tests; only the CLI path runs the API calls.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => fail(error?.stack || String(error)))
}
