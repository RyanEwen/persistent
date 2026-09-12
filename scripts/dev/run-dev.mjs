#!/usr/bin/env node
/**
 * Starts a checkout-specific Devkit stack. The same runner performs database preparation and
 * watcher startup when Compose invokes it with `--container-runtime`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkoutCompose,
  checkoutComposeLifecycle,
  inheritWorktreeFiles,
  preflight
} from '@ryanewen/devkit'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Linked worktrees do not receive ignored files from Git. Copy only configured, absent files from
// the primary checkout before this runner reads .env; a worktree's existing file always wins.
await inheritWorktreeFiles({ repoRoot })

// Match the API and Vite entry points: explicit shell values win over the root .env file.
const envPath = path.join(repoRoot, '.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

const teardown = process.argv.includes('--down')
const containerRuntime = process.argv.includes('--container-runtime')
let hostMode = null
if (!containerRuntime) {
  try {
    hostMode = await preflight({ repoRoot, teardown })
  } catch (error) {
    console.error(`\n[dev] ${error.message}\n`)
    process.exit(1)
  }
  if (!hostMode) {
    console.error('\n[dev] Devkit is not enabled; run `npm run dev:bootstrap` once on this host.\n')
    process.exit(1)
  }
}

// Host mode intentionally overrides fixed .env values with this checkout's derived resources.
if (hostMode) Object.assign(process.env, hostMode.env)

function runSync(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

let composeInvocation = null
let composeLifecycle = null
if (hostMode) {
  composeInvocation = checkoutCompose(hostMode, {
    files: [path.join(repoRoot, 'compose.dev.yml')],
    projectDirectory: repoRoot,
    env: {
      DEVKIT_WEB_PORT: String(hostMode.ports.web),
      HOST_UID: String(process.getuid?.() ?? 1000),
      HOST_GID: String(process.getgid?.() ?? 1000)
    }
  })
  composeLifecycle = checkoutComposeLifecycle(hostMode, composeInvocation)
  if (teardown) {
    process.exit(composeLifecycle.stop())
  }
} else {
  runSync('node', ['scripts/dev/wait-for-db.mjs'])
  runSync('npm', ['run', 'db:generate'])
  runSync('npm', ['run', 'db:migrate:deploy'])
  runSync('npm', ['run', 'build', '--workspace', '@persistent/shared'])
}

if (hostMode) {
  for (const line of hostMode.lines) console.log(`[dev] ${line}`)
  console.log('')
  console.log(`  ${hostMode.identity.repoName}${hostMode.identity.isPrimary ? '' : ` / ${hostMode.identity.worktreeName}`}  ->  ${hostMode.url}`)
  console.log(`  direct${' '.repeat(Math.max(1, hostMode.identity.repoName.length - 5))}  ->  ${hostMode.directUrl}`)
  console.log('')
}

if (composeLifecycle) {
  try {
    process.exit(await composeLifecycle.run(['up', '--build', '--remove-orphans']))
  } catch (error) {
    console.error(`[dev] could not start Docker Compose: ${error.message}`)
    process.exit(1)
  }
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

// Ctrl-C already reaches the foreground process group, including concurrently and its children.
child.on('exit', (code) => process.exit(code ?? 0))
