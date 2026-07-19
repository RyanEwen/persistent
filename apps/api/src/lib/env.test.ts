import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
const { envKeys } = await import('./env.js')

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const read = (name: string) => readFileSync(join(repoRoot, name), 'utf8')

/** Keys under a service's `environment:` block in compose.server.yml. */
function composeEnvKeys(): string[] {
  return [...read('compose.server.yml').matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!)
}

/** Keys set as `ENV NAME=` in the Dockerfile. */
function dockerfileEnvKeys(): string[] {
  return [...read('Dockerfile').matchAll(/^ENV ([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!)
}

test('every env var the API reads is supplied to the container', () => {
  // compose.server.yml enumerates the container environment rather than passing
  // the host .env wholesale, so a key the schema reads but the deployment never
  // sets is undefined in production — with no error, just a quietly disabled
  // feature. This is the check that catches that before it ships.
  const provided = new Set([...composeEnvKeys(), ...dockerfileEnvKeys()])
  const missing = envKeys.filter((key) => !provided.has(key))
  assert.deepEqual(
    missing,
    [],
    `Not provided to the container: ${missing.join(', ')}. ` +
      'Add them to the api service\'s environment: block in compose.server.yml (or as a Dockerfile ENV).'
  )
})

test('the image never bakes in a .env', () => {
  // lib/env.ts imports dotenv/config, so a .env copied into the image would be
  // read in preference to nothing — embedding secrets in a distributable layer
  // and hiding the container's real configuration. .dockerignore must exclude it.
  const ignored = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  assert.ok(ignored.includes('.env'), '.dockerignore must exclude .env')
  assert.ok(ignored.includes('.env.*'), '.dockerignore must exclude .env.* (backups, per-env files)')
})
