/**
 * Unit tests for the pure parts of the Play publisher. The API calls are not
 * covered here (they need a live Play edit); what is covered is everything that
 * silently corrupts a release if it's wrong — note truncation against Play's
 * 500-character cap, and the versionCode comparison the CI pre-flight gates on.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseArgs,
  parseTracks,
  playNotesFrom,
  highestVersionCode,
  describeTracks,
  listingFromMarkdown,
  listingProblems,
  describeListingDiff,
  LISTING_LIMITS,
  pngSize,
  pngHasAlpha,
  screenshotProblems
  // @ts-expect-error - plain .mjs script, no type declarations
} from './play-publish.mjs'

/** Minimal valid PNG header: signature + IHDR with the given size/colour type. */
function fakePng(width: number, height: number, colorType = 2): Buffer {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf.writeUInt8(8, 24)
  buf.writeUInt8(colorType, 25)
  return buf
}

describe('parseArgs', () => {
  it('reads flag/value pairs', () => {
    assert.deepEqual(parseArgs(['--aab', 'app.aab', '--tracks', 'internal,alpha']), {
      aab: 'app.aab',
      tracks: 'internal,alpha'
    })
  })

  it('treats a flag with no value as a boolean', () => {
    assert.deepEqual(parseArgs(['--check', '--version-code', '40']), { check: true, 'version-code': '40' })
  })

  it('ignores positional noise', () => {
    assert.deepEqual(parseArgs(['stray', '--status', 'draft']), { status: 'draft' })
  })
})

describe('parseTracks', () => {
  it('splits, trims and dedupes', () => {
    assert.deepEqual(parseTracks(' internal, alpha ,internal'), ['internal', 'alpha'])
  })

  it('returns nothing for empty input', () => {
    assert.deepEqual(parseTracks(''), [])
    assert.deepEqual(parseTracks(undefined), [])
  })
})

describe('playNotesFrom', () => {
  const notes = [
    "## What's changed",
    '',
    '- Alarms survive a reboot',
    '- Snooze picker remembers the last choice',
    '',
    '**Full changelog**: https://github.com/x/y/compare/v1...v2'
  ].join('\n')

  it('strips the heading and the compare link', () => {
    assert.equal(playNotesFrom(notes), '- Alarms survive a reboot\n- Snooze picker remembers the last choice')
  })

  it('never exceeds the limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => `- Change number ${i}`).join('\n')
    const result = playNotesFrom(many)
    assert.ok(result.length <= 500, `expected <= 500 chars, got ${result.length}`)
  })

  it('truncates on a line boundary, keeping whole entries', () => {
    const long = ['- ' + 'a'.repeat(300), '- ' + 'b'.repeat(300), '- ' + 'c'.repeat(10)].join('\n')
    const result = playNotesFrom(long)
    // Only the first line fits in 500; a partial second line would read as a
    // sentence that stops mid-word in the Play listing.
    assert.equal(result, '- ' + 'a'.repeat(300))
  })

  it('keeps a single over-long line rather than dropping the notes', () => {
    const result = playNotesFrom('- ' + 'x'.repeat(900))
    assert.equal(result.length, 500)
    assert.ok(result.endsWith('…'))
  })

  it('falls back to generic text when nothing survives', () => {
    assert.equal(playNotesFrom("## What's changed\n\n"), 'Bug fixes and improvements.')
    assert.equal(playNotesFrom(''), 'Bug fixes and improvements.')
  })
})

describe('highestVersionCode', () => {
  it('spans every track and release', () => {
    const tracks = [
      { track: 'internal', releases: [{ versionCodes: ['39'] }, { versionCodes: ['41'] }] },
      { track: 'alpha', releases: [{ versionCodes: ['40'] }] }
    ]
    assert.equal(highestVersionCode(tracks), 41)
  })

  it('is 0 when Play has nothing', () => {
    assert.equal(highestVersionCode([]), 0)
    assert.equal(highestVersionCode(undefined), 0)
    assert.equal(highestVersionCode([{ track: 'internal' }]), 0)
  })
})

describe('describeTracks', () => {
  it('renders one line per track', () => {
    const out = describeTracks([
      { track: 'internal', releases: [{ versionCodes: ['40'], status: 'completed' }] },
      { track: 'production', releases: [] }
    ])
    assert.equal(out, '  internal: 40 (completed)\n  production: (empty)')
  })

  it('says so when no track has a release', () => {
    assert.match(describeTracks([]), /no tracks/)
  })
})

describe('listingFromMarkdown', () => {
  // Deliberately shaped like the real listing.md: other fenced blocks before and
  // after the ones we want, so a parser counting fences picks up the wrong text.
  const markdown = [
    '# Google Play store listing',
    '',
    '## App name (max 30 chars)',
    '',
    '```',
    'Persistent: Reminders That Nag',
    '```',
    '',
    '## Short description (max 80 chars)',
    '',
    '```',
    'Reminders that nag until you confirm them done.',
    '```',
    '',
    '## Full description (max 4000 chars)',
    '',
    '```',
    'Line one.',
    '',
    'Line two.',
    '```',
    '',
    '## Capturing more',
    '',
    '```',
    'adb exec-out screencap -p > shot.png',
    '```'
  ].join('\n')

  it('takes the block under each heading, not the Nth block in the file', () => {
    const listing = listingFromMarkdown(markdown)
    assert.equal(listing.shortDescription, 'Reminders that nag until you confirm them done.')
    assert.equal(listing.fullDescription, 'Line one.\n\nLine two.')
  })

  it('keeps blank lines inside the description', () => {
    // Play renders the paragraph breaks; collapsing them would reflow the listing.
    assert.match(listingFromMarkdown(markdown).fullDescription, /Line one\.\n\nLine two\./)
  })

  it('throws rather than returning a partial listing', () => {
    const noFull = markdown.split('## Full description')[0]
    assert.throws(() => listingFromMarkdown(noFull), /Full description/)
  })

  it('does not borrow the next section when a heading has no block', () => {
    const empty = ['## Short description (max 80 chars)', '', '## Full description (max 4000 chars)', '', '```', 'x', '```'].join('\n')
    assert.throws(() => listingFromMarkdown(empty), /Short description/)
  })
})

describe('listingProblems', () => {
  it('passes copy inside the limits', () => {
    assert.deepEqual(listingProblems({ shortDescription: 'Short.', fullDescription: 'Full.' }), [])
  })

  it('catches an over-long description — the bug a hand-written count missed', () => {
    const problems = listingProblems({
      shortDescription: 'ok',
      fullDescription: 'x'.repeat(LISTING_LIMITS.fullDescription + 1)
    })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /fullDescription is 4001 characters/)
  })

  it('treats an empty field as a problem — Play reads it as "clear this"', () => {
    const problems = listingProblems({ shortDescription: '', fullDescription: 'Full.' })
    assert.match(problems[0], /shortDescription is empty/)
  })

  it('counts characters the way a person does, not UTF-16 units', () => {
    // An em dash and a bullet are one character each; the description is full of
    // both, so a naive .length would over-count and reject valid copy.
    assert.deepEqual(listingProblems({ shortDescription: '— • ✓', fullDescription: 'ok' }), [])
  })
})

describe('describeListingDiff', () => {
  it('names the fields that would change', () => {
    const out = describeListingDiff(
      { shortDescription: 'old', fullDescription: 'same' },
      { shortDescription: 'new copy', fullDescription: 'same' }
    )
    assert.match(out, /shortDescription: CHANGED \(3 -> 8\/80 chars\)/)
    assert.match(out, /fullDescription: unchanged \(4\/4000 chars\)/)
  })

  it('handles Play returning no listing at all', () => {
    assert.match(describeListingDiff(undefined, { shortDescription: 'a', fullDescription: 'b' }), /CHANGED \(0 -> 1/)
  })
})

describe('screenshot checks', () => {
  it('reads dimensions out of the PNG header', () => {
    assert.deepEqual(pngSize(fakePng(1120, 2495)), { width: 1120, height: 2495 })
  })

  it('rejects anything that is not a PNG', () => {
    assert.equal(pngSize(Buffer.from('not an image at all, just bytes')), null)
  })

  it('spots an alpha channel — Play rejects the upload for it', () => {
    assert.equal(pngHasAlpha(fakePng(960, 2142, 6)), true) // RGBA
    assert.equal(pngHasAlpha(fakePng(960, 2142, 4)), true) // grey + alpha
    assert.equal(pngHasAlpha(fakePng(960, 2142, 2)), false) // RGB, what Play wants
  })

  it('passes a healthy set', () => {
    const shots = [
      { name: '00.png', bytes: fakePng(960, 2142) },
      { name: '01.png', bytes: fakePng(1120, 2495) }
    ]
    assert.deepEqual(screenshotProblems(shots), [])
  })

  it('names the offending file, since Play\'s own error does not', () => {
    const shots = [
      { name: 'good.png', bytes: fakePng(1120, 2495) },
      { name: 'alpha.png', bytes: fakePng(960, 2142, 6) },
      { name: 'tiny.png', bytes: fakePng(200, 400) }
    ]
    const problems = screenshotProblems(shots)
    assert.ok(problems.some((p: string) => p.startsWith('alpha.png') && /alpha channel/.test(p)))
    assert.ok(problems.some((p: string) => p.startsWith('tiny.png') && /320-3840/.test(p)))
    assert.ok(!problems.some((p: string) => p.startsWith('good.png')))
  })

  it('enforces Play\'s 2-8 count', () => {
    const one = [{ name: 'a.png', bytes: fakePng(1120, 2495) }]
    assert.ok(screenshotProblems(one).some((p: string) => /2-8 phone screenshots/.test(p)))
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `${i}.png`, bytes: fakePng(1120, 2495) }))
    assert.ok(screenshotProblems(nine).some((p: string) => /2-8 phone screenshots/.test(p)))
  })
})

/**
 * Integration coverage for the request sequence itself — the part that replaced
 * a third-party publish action, and the part unit tests of pure helpers cannot
 * reach. A local mock stands in for both the OAuth endpoint and the Play API.
 */
describe('publish request sequence', () => {
  type Call = { method: string; path: string; body: string }

  async function runPublish(
    args: string[],
    opts: { commitFailsForReview?: boolean; existingTracks?: unknown[]; existingListing?: unknown } = {}
  ): Promise<{ calls: Call[]; stdout: string; stderr: string; code: number | null }> {
    const http = await import('node:http')
    const { generateKeyPairSync } = await import('node:crypto')
    // spawn, not spawnSync: the mock server shares this process's event loop, so
    // a synchronous child would deadlock waiting for a reply that can't be sent.
    const { spawn } = await import('node:child_process')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')

    const calls: Call[] = []
    let commitAttempts = 0

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const path = req.url ?? ''
        const body = Buffer.concat(chunks)
        calls.push({ method: req.method ?? '', path, body: body.toString('utf8').slice(0, 2000) })
        const json = (payload: unknown, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(payload))
        }
        if (path.endsWith('/token')) return json({ access_token: 'test-token' })
        if (path.endsWith('/bundles?uploadType=media')) return json({ versionCode: 40 })
        if (path.endsWith('/tracks') && req.method === 'GET') return json({ tracks: opts.existingTracks ?? [] })
        if (path.includes(`/${'phoneScreenshots'}`)) {
          if (req.method === 'GET') return json({ images: [{ id: 'old-1' }, { id: 'old-2' }] })
          if (req.method === 'DELETE') return json({})
          return json({ image: { id: 'new' } })
        }
        if (path.includes('/listings/') && req.method === 'GET') {
          return json(
            opts.existingListing ?? {
              language: 'en-US',
              title: 'Persistent: Reminders That Nag',
              shortDescription: 'The old short description.',
              fullDescription: 'The old full description.',
              video: 'https://youtu.be/promo'
            }
          )
        }
        if (path.includes(':commit')) {
          commitAttempts++
          if (opts.commitFailsForReview && !path.includes('changesNotSentForReview')) {
            return json({ error: { message: 'Please set the query parameter changesNotSentForReview to true.' } }, 400)
          }
          return json({ id: 'edit-1', commitAttempts })
        }
        if (path.endsWith('/edits') && req.method === 'POST') return json({ id: 'edit-1' })
        return json({})
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${port}`

    const { privateKey: pem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const dir = mkdtempSync(join(tmpdir(), 'play-publish-'))
    const aabPath = join(dir, 'app.aab')
    writeFileSync(aabPath, Buffer.alloc(1024, 7))
    const notesPath = join(dir, 'RELEASE_NOTES.md')
    writeFileSync(notesPath, "## What's changed\n\n- Alarms survive a reboot\n\n**Full changelog**: https://x/y\n")
    const listingPath = join(dir, 'listing.md')
    writeFileSync(
      listingPath,
      [
        '## Short description (max 80 chars)',
        '',
        '```',
        'Reminders that nag until you confirm them done.',
        '```',
        '',
        '## Full description (max 4000 chars)',
        '',
        '```',
        'Every other reminder app lets you swipe away and forget.',
        '```',
        ''
      ].join('\n')
    )

    try {
      const child = spawn(
        'node',
        [
          'scripts/play-publish.mjs',
          ...args.map((a) =>
            a.replace('{aab}', aabPath).replace('{notes}', notesPath).replace('{listing}', listingPath)
          )
        ],
        {
          cwd: new URL('..', import.meta.url).pathname,
          env: {
            ...process.env,
            PLAY_API_BASE: base,
            PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
              client_email: 'ci@test.iam.gserviceaccount.com',
              private_key: pem,
              token_uri: `${base}/token`
            })
          }
        }
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (c) => (stdout += c))
      child.stderr.on('data', (c) => (stderr += c))
      const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
      return { calls, stdout, stderr, code }
    } finally {
      // Always close: a leaked listener keeps the test runner alive forever.
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('uploads once and attaches the same versionCode to every track in one edit', async () => {
    const { calls, stdout, code } = await runPublish([
      '--aab',
      '{aab}',
      '--tracks',
      'internal,alpha',
      '--version-name',
      '0.17.0',
      '--notes',
      '{notes}'
    ])
    assert.equal(code, 0, `expected success, stdout:\n${stdout}`)

    const edits = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/edits'))
    const uploads = calls.filter((c) => c.path.includes('/bundles?uploadType=media'))
    const trackPuts = calls.filter((c) => c.method === 'PUT' && c.path.includes('/tracks/'))
    const commits = calls.filter((c) => c.path.includes(':commit'))

    assert.equal(edits.length, 1, 'exactly one edit')
    assert.equal(uploads.length, 1, 'the AAB is uploaded exactly once — Play rejects a reused versionCode')
    assert.equal(commits.length, 1, 'exactly one commit')
    assert.deepEqual(
      trackPuts.map((c) => c.path.split('/tracks/')[1]),
      ['internal', 'alpha'],
      'both requested tracks are set'
    )

    // Every track carries the versionCode the upload returned, with the notes.
    for (const put of trackPuts) {
      const payload = JSON.parse(put.body)
      assert.deepEqual(payload.releases[0].versionCodes, ['40'])
      assert.equal(payload.releases[0].status, 'completed')
      assert.equal(payload.releases[0].name, '0.17.0')
      assert.equal(payload.releases[0].releaseNotes[0].text, '- Alarms survive a reboot')
    }
    // All track writes happen inside the single edit, before the commit.
    assert.ok(calls.indexOf(trackPuts[1]) < calls.indexOf(commits[0]))
  })

  it('retries the commit without review submission when Play demands it', async () => {
    const { calls, code, stdout } = await runPublish(
      ['--aab', '{aab}', '--tracks', 'internal', '--version-name', '0.17.0'],
      { commitFailsForReview: true }
    )
    assert.equal(code, 0, `expected recovery, stdout:\n${stdout}`)
    const commits = calls.filter((c) => c.path.includes(':commit'))
    assert.equal(commits.length, 2)
    assert.ok(!commits[0].path.includes('changesNotSentForReview'))
    assert.ok(commits[1].path.includes('changesNotSentForReview=true'))
  })

  it('--check rejects a versionCode Play already has, and leaves no edit behind', async () => {
    const { calls, stderr, code } = await runPublish(['--check', '--version-code', '40'], {
      existingTracks: [{ track: 'internal', releases: [{ versionCodes: ['41'], status: 'completed' }] }]
    })
    assert.equal(code, 1)
    assert.match(stderr, /not higher than 41/)
    assert.match(stderr, /PLAY_VERSION_CODE_OFFSET to at least 2/)
    // The read-only probe must clean up its edit even on the failure path.
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.includes('/edits/edit-1')))
  })

  it('--check passes and uploads nothing when the versionCode is clear', async () => {
    const { calls, code, stdout } = await runPublish(['--check', '--version-code', '42'], {
      existingTracks: [{ track: 'internal', releases: [{ versionCodes: ['41'], status: 'completed' }] }]
    })
    assert.equal(code, 0, stdout)
    assert.equal(calls.filter((c) => c.path.includes('/bundles')).length, 0)
    assert.match(stdout, /highest versionCode on Play: 41/)
  })

  it('--listing patches only the descriptions, then commits', async () => {
    const { calls, code, stdout } = await runPublish(['--listing', '{listing}', '--no-screenshots'])
    assert.equal(code, 0, `expected success, stdout:\n${stdout}`)

    const patches = calls.filter((c) => c.method === 'PATCH' && c.path.includes('/listings/'))
    assert.equal(patches.length, 1, 'exactly one listing write')
    assert.ok(patches[0].path.endsWith('/listings/en-US'))

    const payload = JSON.parse(patches[0].body)
    assert.equal(payload.shortDescription, 'Reminders that nag until you confirm them done.')
    assert.equal(payload.fullDescription, 'Every other reminder app lets you swipe away and forget.')
    // PATCH, and only these fields: the same resource holds the app title and
    // the promo video, and naming them here would be the way to wipe them.
    assert.deepEqual(Object.keys(payload).sort(), ['fullDescription', 'language', 'shortDescription'])

    assert.equal(calls.filter((c) => c.path.includes(':commit')).length, 1)
    assert.equal(calls.filter((c) => c.path.includes('/bundles')).length, 0, 'no bundle touched')
  })

  it('--listing --check writes nothing and leaves no edit behind', async () => {
    const { calls, code, stdout } = await runPublish(['--listing', '{listing}', '--check', '--no-screenshots'])
    assert.equal(code, 0, stdout)
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
    assert.equal(calls.filter((c) => c.path.includes(':commit')).length, 0)
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.includes('/edits/edit-1')))
    // It still reports what a push would change.
    assert.match(stdout, /shortDescription: CHANGED/)
  })

  it('--listing replaces the whole screenshot set inside one edit', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'play-shots-'))
    // Named out of order on disk to prove the upload is sorted, not readdir order:
    // Play shows screenshots in upload order and the numbering is the intent.
    for (const name of ['02-b.png', '00-a.png', '01-c.png']) {
      writeFileSync(join(dir, name), fakePng(1120, 2495))
    }
    const { calls, code, stdout } = await runPublish(['--listing', '{listing}', '--screenshots', dir])
    assert.equal(code, 0, `expected success, stdout:\n${stdout}`)

    const deletes = calls.filter((c) => c.method === 'DELETE' && c.path.includes('phoneScreenshots'))
    const uploads = calls.filter((c) => c.method === 'POST' && c.path.includes('phoneScreenshots'))
    assert.equal(deletes.length, 1, 'the old set is cleared exactly once')
    assert.equal(uploads.length, 3, 'every local screenshot is uploaded')

    const commit = calls.findIndex((c) => c.path.includes(':commit'))
    assert.ok(calls.indexOf(uploads[2]) < commit, 'uploads land inside the edit, before the commit')
    assert.ok(calls.indexOf(deletes[0]) < calls.indexOf(uploads[0]), 'clear before upload')
    // The descriptions still go up in the same edit.
    assert.equal(calls.filter((c) => c.method === 'PATCH' && c.path.includes('/listings/')).length, 1)
  })

  it('--no-screenshots leaves the images on Play alone', async () => {
    const { calls, code } = await runPublish(['--listing', '{listing}', '--no-screenshots'])
    assert.equal(code, 0)
    assert.equal(calls.filter((c) => c.path.includes('phoneScreenshots')).length, 0)
  })

  it('--listing refuses an over-limit description before opening an edit', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const bad = join(mkdtempSync(join(tmpdir(), 'play-listing-')), 'listing.md')
    writeFileSync(
      bad,
      ['## Short description (max 80 chars)', '', '```', 'ok', '```', '', '## Full description (max 4000 chars)', '', '```', 'x'.repeat(4001), '```', ''].join('\n')
    )
    const { calls, code, stderr } = await runPublish(['--listing', bad, '--no-screenshots'])
    assert.equal(code, 1)
    assert.match(stderr, /fullDescription is 4001 characters/)
    // Nothing reached Play — not even an edit that would linger uncommitted.
    assert.equal(calls.filter((c) => c.path.includes('/edits')).length, 0)
  })
})
