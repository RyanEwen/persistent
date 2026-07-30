/**
 * Unit tests for the pure parts of the Play publisher. The API calls are not
 * covered here (they need a live Play edit); what is covered is everything that
 * silently corrupts a release if it's wrong — note truncation against Play's
 * 500-character cap, and the versionCode comparison the CI pre-flight gates on.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// @ts-expect-error - plain .mjs script, no type declarations
import { parseArgs, parseTracks, playNotesFrom, highestVersionCode, describeTracks } from './play-publish.mjs'

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

/**
 * Integration coverage for the request sequence itself — the part that replaced
 * a third-party publish action, and the part unit tests of pure helpers cannot
 * reach. A local mock stands in for both the OAuth endpoint and the Play API.
 */
describe('publish request sequence', () => {
  type Call = { method: string; path: string; body: string }

  async function runPublish(
    args: string[],
    opts: { commitFailsForReview?: boolean; existingTracks?: unknown[] } = {}
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

    try {
      const child = spawn(
        'node',
        ['scripts/play-publish.mjs', ...args.map((a) => a.replace('{aab}', aabPath).replace('{notes}', notesPath))],
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
})
