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
 *   --listing [md]  Push the whole store listing — the descriptions from
 *                   store/listing.md and the phone screenshots from
 *                   store/graphics/screenshots (--no-screenshots for copy only,
 *                   --screenshots <dir> to point elsewhere). Add --check to diff
 *                   against what Play currently serves and write nothing.
 *                   Deliberately not part of a release: the copy changes on its
 *                   own schedule, so it rides a manual workflow_dispatch
 *                   (.github/workflows/play-listing.yml) instead.
 *   --promote       Move a versionCode that is already on Play onto one more
 *                   track, with no upload and no build. Needs --version-code and
 *                   a single --tracks destination; --from picks which track's
 *                   release name and notes to carry forward when the build sits
 *                   on several. --rollout <0..1> starts a staged rollout instead
 *                   of releasing to everyone at once.
 *   (default)       Upload --aab and release it to --tracks.
 *
 * Usage:
 *   node scripts/play-publish.mjs --check --version-code 40
 *   node scripts/play-publish.mjs --listing store/listing.md [--check] [--no-screenshots]
 *   node scripts/play-publish.mjs --aab app.aab --tracks internal,alpha \
 *     --version-name 0.17.0 --notes RELEASE_NOTES.md [--status completed|draft]
 *   node scripts/play-publish.mjs --promote --version-code 45 --tracks production \
 *     [--from alpha] [--rollout 0.2]
 */
import { readFileSync, readdirSync } from 'node:fs'
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

/** Where the listing copy lives, relative to apps/mobile (this script's cwd in CI). */
const DEFAULT_LISTING = 'store/listing.md'
const LISTING_LANGUAGE = 'en-US'

/**
 * Play's caps on the fields this script writes. Enforced here rather than left
 * to the API because the listing markdown used to carry a hand-written character
 * count that was wrong by 1,500 — the description sat over the limit for months
 * with nothing to catch it. This is now the count that matters.
 */
export const LISTING_LIMITS = { shortDescription: 80, fullDescription: 4000 }

/** Where the phone screenshots live, relative to apps/mobile. */
const DEFAULT_SCREENSHOTS = 'store/graphics/screenshots'
/** Play's slot name for phone screenshots; the listing carries several image types. */
const SCREENSHOT_TYPE = 'phoneScreenshots'

/**
 * Play's rules for a phone screenshot. Checked here because the API's rejection
 * arrives mid-edit with a message that doesn't name the offending file.
 */
export const SCREENSHOT_RULES = { min: 320, max: 3840, maxBytes: 8 * 1024 * 1024, count: [2, 8] }

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

/**
 * The first fenced block under a `## <heading>` section, or null.
 *
 * Anchored on the heading rather than counting fences from the top of the file:
 * listing.md holds several other fenced blocks (the adb capture commands, the
 * App access instructions for reviewers), so block order is not a stable index —
 * and picking the wrong one would overwrite the live store listing with the
 * wrong text. Stops at the next `##` so a section with no block reports absent
 * instead of borrowing the following section's.
 */
function fencedBlockUnder(markdown, heading) {
  const lines = String(markdown ?? '').split('\n')
  const heading_ = new RegExp(`^##\\s+${heading}\\b`, 'i')
  const start = lines.findIndex((line) => heading_.test(line))
  if (start === -1) return null

  let open = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    if (lines[i].startsWith('```')) {
      open = i
      break
    }
  }
  if (open === -1) return null

  const close = lines.findIndex((line, i) => i > open && line.startsWith('```'))
  if (close === -1) return null
  return lines.slice(open + 1, close).join('\n').trim()
}

/**
 * Pull the store copy out of listing.md. Throws rather than returning a partial
 * listing: a half-read file would push an empty field, and Play takes that as
 * "clear this field" rather than "leave it alone".
 */
export function listingFromMarkdown(markdown) {
  const shortDescription = fencedBlockUnder(markdown, 'Short description')
  const fullDescription = fencedBlockUnder(markdown, 'Full description')
  const missing = [
    shortDescription === null ? 'Short description' : null,
    fullDescription === null ? 'Full description' : null
  ].filter(Boolean)
  if (missing.length) {
    throw new Error(
      `Could not find a fenced block under: ${missing.map((m) => `"## ${m}"`).join(' and ')}.\n` +
        'The listing copy is read from the first ``` block beneath each of those headings.'
    )
  }
  return { shortDescription, fullDescription }
}

/** Play's character count, per field. Empty is a problem too — see above. */
export function listingProblems(listing) {
  const problems = []
  for (const [field, limit] of Object.entries(LISTING_LIMITS)) {
    // Spread, not .length: counts characters the way a person does, so an em
    // dash or a bullet costs one rather than a surrogate pair's two.
    const size = [...(listing?.[field] ?? '')].length
    if (size === 0) problems.push(`${field} is empty — Play would clear the live text.`)
    else if (size > limit) problems.push(`${field} is ${size} characters; Play's limit is ${limit}.`)
  }
  return problems
}

/** Per-field "unchanged / CHANGED" summary, so a push says what it is about to do. */
export function describeListingDiff(current, next) {
  return Object.keys(LISTING_LIMITS)
    .map((field) => {
      const before = current?.[field] ?? ''
      const after = next?.[field] ?? ''
      const size = `${[...after].length}/${LISTING_LIMITS[field]}`
      if (before === after) return `  ${field}: unchanged (${size} chars)`
      return `  ${field}: CHANGED (${[...before].length} -> ${size} chars)`
    })
    .join('\n')
}

/**
 * PNG dimensions, straight from the IHDR chunk. Avoids a dependency for the one
 * fact Play cares about, and doubles as a "is this really a PNG?" check —
 * Play accepts JPEG too, but everything here is a screen capture.
 */
export function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * Whether a PNG carries an alpha channel. Play requires screenshots be 24-bit
 * with no alpha and rejects the upload otherwise, so this is worth catching
 * before an edit is open. IHDR colour type 4 (grey+alpha) and 6 (RGBA) are the
 * ones that carry it.
 */
export function pngHasAlpha(buffer) {
  if (!pngSize(buffer)) return false
  const colorType = buffer.readUInt8(25)
  return colorType === 4 || colorType === 6
}

/** Everything wrong with a screenshot set, named per file. Empty means publishable. */
export function screenshotProblems(shots) {
  const problems = []
  const [min, max] = SCREENSHOT_RULES.count
  if (shots.length < min || shots.length > max) {
    problems.push(`Play takes ${min}-${max} phone screenshots; found ${shots.length}.`)
  }
  for (const shot of shots) {
    const size = pngSize(shot.bytes)
    if (!size) {
      problems.push(`${shot.name}: not a PNG.`)
      continue
    }
    if (pngHasAlpha(shot.bytes)) {
      problems.push(`${shot.name}: has an alpha channel; Play wants 24-bit PNG with none.`)
    }
    const { width, height } = size
    if (Math.min(width, height) < SCREENSHOT_RULES.min || Math.max(width, height) > SCREENSHOT_RULES.max) {
      problems.push(
        `${shot.name}: ${width}x${height} — each side must be ${SCREENSHOT_RULES.min}-${SCREENSHOT_RULES.max}px.`
      )
    }
    if (shot.bytes.length > SCREENSHOT_RULES.maxBytes) {
      problems.push(`${shot.name}: ${(shot.bytes.length / 1e6).toFixed(1)} MB exceeds Play's 8 MB cap.`)
    }
  }
  return problems
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

/**
 * What Play's unhelpfully generic track-write refusal probably means, or null.
 *
 * Writing a release to a track the app is not yet eligible for answers
 * `FAILED_PRECONDITION` with the message "Precondition check failed." and nothing
 * else: no field, no reason, no link. It is the same answer for every unmet
 * requirement, and it is the first thing anyone promoting to production for the
 * first time will hit, so the checklist belongs here rather than in someone's
 * memory.
 */
export function trackPreconditionHelp(track, status) {
  if (status !== 'FAILED_PRECONDITION') return null
  return (
    `Play refused to put a release on '${track}' and gave no reason beyond "precondition failed".\n` +
    'That single error covers every way an app can be ineligible for a track. For a first\n' +
    `release to '${track}', check in the Play Console, in this order:\n` +
    '  1. Closed testing requirement. A personal (non-organization) developer account has to\n' +
    '     run a closed test with at least 12 testers opted in for 14 continuous days before\n' +
    '     production unlocks. This is the usual answer, it cannot be waived, and no API call\n' +
    '     will succeed until it is satisfied.\n' +
    '  2. App content declarations: privacy policy, data safety, content rating, target\n' +
    '     audience, ads, and any of the "is your app a ..." questions. All must be complete,\n' +
    '     not merely started.\n' +
    '  3. Store listing and the countries/regions the release goes to.\n' +
    'Nothing was written: the edit was never committed, so the track is untouched.'
  )
}

/**
 * The release carrying [versionCode], and the track it was found on.
 *
 * A promotion copies a build that is already on Play onto another track, so the
 * name and "what's new" have to come from somewhere: taking them from the source
 * release is what makes production show testers' notes rather than a placeholder,
 * and it is why this returns the whole release rather than just a boolean.
 *
 * `preferred` is searched first so a build sitting on several tracks resolves to
 * the one being promoted from, which is the one whose notes are current.
 */
export function findRelease(tracks, versionCode, preferred) {
  const wanted = String(versionCode)
  const order = [...(tracks ?? [])].sort((a, b) => {
    if (a.track === preferred) return -1
    if (b.track === preferred) return 1
    return 0
  })
  for (const track of order) {
    for (const release of track.releases ?? []) {
      if ((release.versionCodes ?? []).map(String).includes(wanted)) {
        return { track: track.track, release }
      }
    }
  }
  return null
}

/**
 * Why [versionCode] must not go onto [target], or null when it may.
 *
 * Play accepts a promotion that moves a track *backwards*, which would hand
 * production an older build than it already serves and, with no error to notice,
 * quietly un-ship whatever was there. Refusing here is the only guard, since a
 * promotion has no build step to catch it the way an upload's versionCode check
 * does.
 */
export function promotionBlocker(tracks, versionCode, target) {
  const existing = (tracks ?? []).find((track) => track.track === target)
  if (!existing) return null
  const highest = highestVersionCode([existing])
  if (highest && Number(versionCode) < highest) {
    return `${target} already serves versionCode ${highest}; promoting ${versionCode} would move it backwards.`
  }
  return null
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
async function playFetch(token, path, { method = 'GET', body, raw, rawType, tolerate, bestEffort } = {}) {
  const headers = { Authorization: `Bearer ${token}` }
  let payload
  if (raw) {
    // Content-Length is left to undici — it derives it from the buffer, and
    // setting it here risks a duplicate/conflicting header.
    headers['Content-Type'] = rawType ?? 'application/octet-stream'
    payload = raw
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await request(`${API}${path}`, { method, headers, body: payload }, 'the Play Developer API')
  const text = await response.text()
  if (!response.ok) {
    if (tolerate && text.includes(tolerate)) return { error: text }
    // Cleanup calls on a failure path: the real error is the one already being
    // reported, and dying inside the tidy-up would hide it.
    if (bestEffort) return { error: text }
    fail(`${method} ${path} failed (HTTP ${response.status}): ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

const editsPath = (pkg, editId = '') => `/androidpublisher/v3/applications/${pkg}/edits${editId ? `/${editId}` : ''}`

/**
 * Commit an edit, retrying without review submission if Play insists.
 *
 * Play refuses to auto-submit for review while the app already has changes
 * pending review. The edit itself is still valid; it just has to be committed
 * without the submission, and the change waits for the next review round.
 */
async function commitEdit(token, packageName, editId) {
  const path = `${editsPath(packageName, editId)}:commit`
  const committed = await playFetch(token, path, { method: 'POST', tolerate: 'changesNotSentForReview' })
  if (committed.error) {
    console.log('[play-publish] Play declined to auto-submit for review; committing with changesNotSentForReview=true')
    await playFetch(token, `${path}?changesNotSentForReview=true`, { method: 'POST' })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const packageName = args['package'] || DEFAULT_PACKAGE

  // Validate the invocation before authenticating: a missing flag should fail
  // instantly and unmistakably, not after a token round-trip.
  const listingMode = Boolean(args.listing)
  const promoteMode = Boolean(args.promote)
  const publishing = !args.check && !listingMode && !promoteMode
  const aab = args.aab
  const tracks = parseTracks(args.tracks)
  const versionName = args['version-name']
  const status = args.status || 'completed'
  const rollout = args.rollout === undefined ? null : Number(args.rollout)
  if (promoteMode) {
    if (!Number.isFinite(Number(args['version-code']))) {
      fail('--promote needs --version-code <n>: the build already on Play to move.')
    }
    if (tracks.length !== 1) {
      fail('--promote takes exactly one --tracks value, the destination.')
    }
    if (rollout !== null && !(rollout > 0 && rollout < 1)) {
      fail(`--rollout must be between 0 and 1 exclusive, got '${args.rollout}'.`)
    }
  }
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

  // Same reasoning for the listing: parse and length-check the copy before
  // authenticating, so a malformed file never opens an edit on Play.
  const listingFile = typeof args.listing === 'string' ? args.listing : DEFAULT_LISTING
  const shotsDir = typeof args.screenshots === 'string' ? args.screenshots : DEFAULT_SCREENSHOTS
  // `--no-screenshots` pushes copy alone, for a wording fix that shouldn't
  // re-upload six images (each upload is a fresh asset on Play's side).
  const withShots = listingMode && !args['no-screenshots']
  let listing = null
  let shots = []
  if (listingMode) {
    const markdown = read(listingFile, 'listing markdown', 'utf8')
    try {
      listing = listingFromMarkdown(markdown)
    } catch (error) {
      fail(`${listingFile}: ${error.message}`)
    }
    const problems = listingProblems(listing)
    if (problems.length) fail(`${listingFile} is not publishable:\n  - ${problems.join('\n  - ')}`)
  }
  if (withShots) {
    // Sorted by filename: Play shows screenshots in upload order, and the names
    // are numbered precisely so that order is the one the listing intends.
    let names
    try {
      names = readdirSync(shotsDir)
        .filter((name) => name.toLowerCase().endsWith('.png'))
        .sort()
    } catch (error) {
      return fail(`Could not read the screenshots directory at ${shotsDir}: ${error?.message || error}`)
    }
    shots = names.map((name) => ({ name, bytes: read(`${shotsDir}/${name}`, `screenshot ${name}`) }))
    const problems = screenshotProblems(shots)
    if (problems.length) fail(`${shotsDir} is not publishable:\n  - ${problems.join('\n  - ')}`)
  }

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

  // --- --listing: push the store copy from listing.md ------------------------
  if (listingMode) {
    const edit = await playFetch(token, editsPath(packageName), { method: 'POST', body: {} })
    const path = `${editsPath(packageName, edit.id)}/listings/${LISTING_LANGUAGE}`
    const current = await playFetch(token, path)

    console.log(`[play-publish] ${LISTING_LANGUAGE} listing — Play vs ${listingFile}:`)
    console.log(describeListingDiff(current, listing))

    const imagesPath = `${editsPath(packageName, edit.id)}/listings/${LISTING_LANGUAGE}/${SCREENSHOT_TYPE}`
    if (withShots) {
      const live = await playFetch(token, imagesPath)
      const liveCount = live.images?.length ?? 0
      console.log(`  ${SCREENSHOT_TYPE}: ${liveCount} on Play -> ${shots.length} from ${shotsDir}`)
      for (const shot of shots) {
        const { width, height } = pngSize(shot.bytes)
        console.log(`    ${shot.name} (${width}x${height})`)
      }
    }

    if (args.check) {
      // Read-only probe: drop the edit so it can't linger and block later ones.
      await playFetch(token, editsPath(packageName, edit.id), { method: 'DELETE' })
      console.log('[play-publish] --check: nothing written, edit discarded')
      return
    }

    // PATCH, not PUT. The same resource carries the app title, the promo video
    // URL and the localized graphics, and a PUT omitting them clears them. Only
    // the two description fields are this script's to write.
    await playFetch(token, path, {
      method: 'PATCH',
      body: {
        language: LISTING_LANGUAGE,
        shortDescription: listing.shortDescription,
        fullDescription: listing.fullDescription
      }
    })
    // Replace the whole set rather than diffing: Play has no stable identity for
    // "the third screenshot", so there is nothing to match a local file against.
    // Both the delete and the uploads live inside this edit, so a failure part-way
    // leaves the live listing untouched — the edit simply never commits.
    if (withShots) {
      await playFetch(token, imagesPath, { method: 'DELETE' })
      for (const shot of shots) {
        await playFetch(token, `/upload${imagesPath}?uploadType=media`, {
          method: 'POST',
          raw: shot.bytes,
          rawType: 'image/png'
        })
        console.log(`[play-publish] uploaded ${shot.name}`)
      }
    }

    await commitEdit(token, packageName, edit.id)
    console.log(`[play-publish] committed. ${LISTING_LANGUAGE} listing updated from ${listingFile}`)
    if (withShots) console.log(`[play-publish] ${shots.length} screenshots replaced from ${shotsDir}`)
    console.log('[play-publish] Play reviews listing changes before they go live.')
    return
  }

  // --- --promote: move a build already on Play onto another track -----------
  //
  // No upload: the AAB exists on Play already, and re-uploading it is impossible
  // anyway (Play rejects a versionCode it has seen). The whole operation is
  // "read the release, write it to another track", inside one edit so a failure
  // part-way leaves the destination untouched.
  if (promoteMode) {
    const target = tracks[0]
    const versionCode = Number(args['version-code'])
    const edit = await playFetch(token, editsPath(packageName), { method: 'POST', body: {} })
    const { tracks: current } = await playFetch(token, `${editsPath(packageName, edit.id)}/tracks`)
    console.log('[play-publish] current Play tracks:')
    console.log(describeTracks(current))

    const found = findRelease(current, versionCode, args.from)
    if (!found) {
      await playFetch(token, editsPath(packageName, edit.id), { method: 'DELETE' })
      fail(
        `versionCode ${versionCode} is not on any track, so there is nothing to promote.\n` +
          'Release it to a testing track first (the release workflow does internal + alpha).'
      )
    }
    const blocker = promotionBlocker(current, versionCode, target)
    if (blocker) {
      await playFetch(token, editsPath(packageName, edit.id), { method: 'DELETE' })
      fail(blocker)
    }

    // Carry the source release's name and notes forward: promoting is the same
    // build reaching more people, so it should say the same thing to them.
    const source = found.release
    const release = {
      name: versionName || source.name,
      versionCodes: [String(versionCode)],
      status: rollout === null ? 'completed' : 'inProgress'
    }
    if (rollout !== null) release.userFraction = rollout
    if (source.releaseNotes?.length) release.releaseNotes = source.releaseNotes

    // `tolerate` rather than a bare call: Play answers an ineligible track with a
    // bare "Precondition check failed", and passing that through verbatim is the
    // difference between a two-minute answer and an afternoon.
    const written = await playFetch(token, `${editsPath(packageName, edit.id)}/tracks/${target}`, {
      method: 'PUT',
      body: { track: target, releases: [release] },
      tolerate: 'FAILED_PRECONDITION'
    })
    if (written?.error) {
      await playFetch(token, editsPath(packageName, edit.id), { method: 'DELETE', bestEffort: true })
      fail(trackPreconditionHelp(target, 'FAILED_PRECONDITION'))
    }
    await commitEdit(token, packageName, edit.id)

    const reach = rollout === null ? 'all users' : `${(rollout * 100).toFixed(0)}% of users`
    console.log(
      `[play-publish] committed. versionCode ${versionCode} promoted from ${found.track} ` +
        `to ${target} (${release.name}) for ${reach}`
    )
    if (!source.releaseNotes?.length) {
      console.log('[play-publish] the source release carried no notes, so none were set.')
    }
    return
  }

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

  await commitEdit(token, packageName, edit.id)

  console.log(`[play-publish] committed. ${versionName} (versionCode ${versionCode}) -> ${tracks.join(', ')}`)
  console.log('--- what\'s new ---')
  console.log(notes)
}

// Importable for tests; only the CLI path runs the API calls.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => fail(error?.stack || String(error)))
}
