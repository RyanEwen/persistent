#!/usr/bin/env node
/**
 * Dev orchestrator: builds the shared package once, then runs shared (watch),
 * api, and web concurrently with colored, prefixed output. A single Ctrl-C
 * tears the whole group down.
 *
 * Development is devcontainer-only: the `db` service in
 * .devcontainer/compose.yml provides Postgres. Run this inside the container.
 */
import { spawn } from 'node:child_process'

function run(command, args, label) {
  const child = spawn(command, args, { stdio: 'inherit', shell: false })
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`)
      process.exitCode = code
    }
  })
  return child
}

// Build shared first so api/web typecheck against fresh declarations.
const build = run('npm', ['run', 'build', '--workspace', '@persistent/shared'], 'shared:build')

build.on('exit', (code) => {
  if (code && code !== 0) {
    process.exit(code)
  }

  const dev = run(
    'npx',
    [
      'concurrently',
      '-n', 'shared,api,web',
      '-c', 'magenta,green,blue',
      'npm run dev --workspace @persistent/shared',
      'npm run dev --workspace @persistent/api',
      'npm run dev --workspace @persistent/web'
    ],
    'dev'
  )

  const shutdown = () => dev.kill('SIGINT')
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})
