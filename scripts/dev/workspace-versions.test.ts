import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * package-lock.json records each workspace's version alongside its dependency
 * tree. `/release` bumps apps/web/package.json, which does not touch the lockfile,
 * so the two drift apart silently — at one point the lockfile still claimed 0.7.0
 * while the app was several releases ahead. Nothing breaks immediately, but a lie
 * in the lockfile is confusing at exactly the wrong moment (a release), and
 * `npm ci` writes the stale value into the built image.
 *
 * The fix is to run `npm install --package-lock-only` as part of the bump; this
 * test is what makes forgetting it visible.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))

test('package-lock records the same version as each workspace package.json', () => {
  const root = readJson('package.json') as { workspaces: string[] }
  const lock = readJson('package-lock.json') as { packages: Record<string, { version?: string }> }

  const drifted = root.workspaces.flatMap((workspace) => {
    const declared = (readJson(`${workspace}/package.json`) as { version?: string }).version
    const locked = lock.packages[workspace]?.version
    return declared === locked ? [] : [`${workspace}: package.json ${declared} vs lockfile ${locked ?? '(absent)'}`]
  })

  assert.deepEqual(
    drifted,
    [],
    `Lockfile is out of sync:\n  ${drifted.join('\n  ')}\nRun \`npm install --package-lock-only\` and commit the result.`
  )
})
