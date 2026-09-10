#!/usr/bin/env node
/**
 * Dev orchestrator: prepares the database, builds shared once, then runs shared (watch), api, and
 * web concurrently. Optional @ryanewen/devkit host mode gives each checkout its own hostname,
 * database, and ports. Devkit disables itself in containers and when not bootstrapped, preserving
 * the devcontainer's fixed ports, database service, and environment.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  inheritWorktreeFiles,
  preflight,
  refreshBaselineAfterMigrations,
  removeRoute
} from '@ryanewen/devkit'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Linked worktrees do not receive ignored files from Git. Copy only configured, absent files from
// the primary checkout before this runner reads .env; a worktree's existing file always wins.
await inheritWorktreeFiles({ repoRoot })

// Match the API and Vite entry points: explicit shell values win over the root .env file.
const envPath = path.join(repoRoot, '.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

let hostMode = null
try {
  hostMode = await preflight({ repoRoot })
} catch (error) {
  console.error(`\n[dev] ${error.message}\n`)
  process.exit(1)
}

// Host mode intentionally overrides fixed .env values with this checkout's derived resources.
if (hostMode) Object.assign(process.env, hostMode.env)

function runSync(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// The devcontainer database and devkit's per-checkout database share the same startup contract:
// wait until reachable, then apply only the checked-in migration history before any app boots.
runSync('node', ['scripts/dev/wait-for-db.mjs'])
runSync('npm', ['run', 'db:migrate:deploy'])
runSync('npm', ['run', 'build', '--workspace', '@persistent/shared'])

if (hostMode) {
  for (const line of hostMode.lines) console.log(`[dev] ${line}`)
  console.log('')
  console.log(`  ${hostMode.identity.repoName}${hostMode.identity.isPrimary ? '' : ` / ${hostMode.identity.worktreeName}`}  ->  ${hostMode.url}`)
  console.log(`  direct${' '.repeat(Math.max(1, hostMode.identity.repoName.length - 5))}  ->  ${hostMode.directUrl}`)
  console.log('')
}

const child = spawn(
  'npx',
  [
    'concurrently',
    '-n', 'shared,api,web',
    '-c', 'magenta,green,blue',
    'npm run dev --workspace @persistent/shared',
    'npm run dev --workspace @persistent/api',
    'npm run dev --workspace @persistent/web'
  ],
  { stdio: 'inherit', cwd: repoRoot, env: process.env }
)

// A newly-applied primary-checkout migration makes the baseline stale. Refresh it after watchers
// start so snapshot work never delays the session; failures are advisory by devkit's contract.
if (hostMode) {
  try {
    refreshBaselineAfterMigrations(hostMode)
  } catch (error) {
    console.log(`[dev] baseline refresh skipped: ${error.message}`)
  }
}

// The route points at a port that is about to stop. Removing it is tidiness; a stale route would
// return a bad gateway rather than send traffic to another checkout.
process.on('exit', () => {
  if (hostMode) removeRoute(hostMode.config, hostMode.identity)
})

// Ctrl-C already reaches the foreground process group, including concurrently and its children.
child.on('exit', (code) => process.exit(code ?? 0))
