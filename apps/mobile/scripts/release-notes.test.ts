/**
 * Tests for the release-notes filter.
 *
 * This is generated prose that ships to Google Play and the in-app update prompt,
 * and both failure modes are silent: too permissive and testers read commit
 * archaeology (v0.22.0 led with "Explain Play's bare precondition failed on a track
 * write"), too strict and every release claims "maintenance and behind-the-scenes
 * improvements". Neither errors, so only tests catch them.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  userFacing,
  notesMarkdown,
  subjectsIn,
  FALLBACK
  // @ts-expect-error - plain .mjs script, no type declarations
} from './release-notes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

describe('userFacing', () => {
  it('keeps changes a user can notice', () => {
    assert.deepEqual(userFacing(['Give notes a tab of their own']), ['- Give notes a tab of their own'])
  })

  it('drops version bumps, docs, tooling and tests by subject', () => {
    const dropped = [
      'Bump version to 0.22.0',
      'Update the docs for the alarm contract',
      'Refactor the scheduler',
      'Add a test for the route order',
      'Fix the CI workflow'
    ]
    assert.deepEqual(userFacing(dropped), [FALLBACK])
  })

  it('falls back rather than emitting an empty list', () => {
    assert.deepEqual(userFacing([]), [FALLBACK])
  })

  it('does not double the bullet on already-bulleted input', () => {
    assert.deepEqual(userFacing(['- Already bulleted']), ['- Already bulleted'])
  })
})

describe('notesMarkdown', () => {
  it('includes a compare link when there is a previous tag', () => {
    const md = notesMarkdown(['Give notes a tab of their own'], {
      repo: 'o/r',
      previous: 'v0.1.0',
      tag: 'v0.2.0'
    })
    assert.match(md, /^## What's changed\n\n- Give notes a tab of their own\n\n\*\*Full changelog\*\*/)
    assert.match(md, /compare\/v0\.1\.0\.\.\.v0\.2\.0\n$/)
  })

  it('omits the compare link for a first release', () => {
    const md = notesMarkdown(['Ship it'], { repo: 'o/r', previous: null, tag: 'v0.1.0' })
    assert.doesNotMatch(md, /Full changelog/)
  })
})

describe('subjectsIn', () => {
  // The pathspecs are resolved against the working directory, and the workflow
  // runs this script from apps/mobile. Getting that wrong matches no files at all,
  // so every release silently becomes the fallback line.
  it('reads the same commits whatever directory it runs from', () => {
    const fromRoot = subjectsIn('v0.21.1..v0.22.0', repoRoot)
    const fromHere = subjectsIn('v0.21.1..v0.22.0')
    assert.ok(fromRoot.length > 0, 'the range should have commits')
    assert.deepEqual(fromHere, fromRoot)
  })

  it('excludes build tooling and store copy that sit under a runtime path', () => {
    const subjects = subjectsIn('v0.21.1..v0.22.0', repoRoot)
    assert.ok(
      !subjects.some((s: string) => s.includes('precondition')),
      `apps/mobile/scripts changes must not appear, got: ${subjects.join(' | ')}`
    )
  })
})

describe('the CLI', () => {
  it('prints the notes for a tag', () => {
    const out = execFileSync(
      'node',
      [join(here, 'release-notes.mjs'), '--tag', 'v0.22.0', '--repo', 'o/r'],
      { encoding: 'utf8', cwd: here }
    )
    assert.match(out, /## What's changed/)
    assert.match(out, /- Turn predictive back on/)
    assert.doesNotMatch(out, /precondition/)
  })
})
