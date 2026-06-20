#!/usr/bin/env node
/**
 * Deploy the current `origin/<branch>` to a server over SSH using Docker Compose.
 *
 * The server holds a git checkout at DEPLOY_REPO_PATH and a filled-in
 * `.env.server` next to `compose.server.yml`. This script verifies the local
 * tree is clean and matches the remote branch, then on the server: fetches,
 * hard-resets to the pushed commit, and rebuilds + restarts the stack. Prisma
 * migrations run on container start (`npm run start:prod`).
 *
 * Run via `npm run deploy:prod` (loads .env). Config comes from env, overridable
 * by flags:
 *   --host user@server      DEPLOY_SSH_HOST
 *   --repo-path /srv/app     DEPLOY_REPO_PATH
 *   --branch main            DEPLOY_BRANCH (default: main)
 *   --dry-run                print the remote command, don't run it
 *   --skip-validate          skip the local `npm run validate` gate
 */
import { spawnSync } from 'node:child_process'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 ? process.argv[index + 1] : undefined
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const host = arg('host') ?? process.env.DEPLOY_SSH_HOST
const repoPath = arg('repo-path') ?? process.env.DEPLOY_REPO_PATH
const branch = arg('branch') ?? process.env.DEPLOY_BRANCH ?? 'main'
const dryRun = flag('dry-run')

if (!host || !repoPath) {
  console.error('Missing deploy target. Set DEPLOY_SSH_HOST and DEPLOY_REPO_PATH (in .env) or pass --host/--repo-path.')
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) {
    console.error(`\nCommand failed: ${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
  return result
}

function capture(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' }).stdout?.trim() ?? ''
}

// 1. Local tree must be clean.
if (capture('git', ['status', '--porcelain'])) {
  console.error('Local tree has uncommitted changes. Commit or stash before deploying.')
  process.exit(1)
}

// 2. Local HEAD must match origin/<branch> so we deploy exactly what is pushed.
run('git', ['fetch', 'origin', branch])
const local = capture('git', ['rev-parse', 'HEAD'])
const remote = capture('git', ['rev-parse', `origin/${branch}`])
if (local !== remote) {
  console.error(`Local HEAD (${local.slice(0, 8)}) != origin/${branch} (${remote.slice(0, 8)}). Push first.`)
  process.exit(1)
}

// 3. Optional local validation gate.
if (!flag('skip-validate') && !dryRun) {
  run('npm', ['run', 'validate'])
}

// 4. Remote deploy.
const remoteScript = [
  `cd ${repoPath}`,
  `git fetch origin ${branch}`,
  `git reset --hard origin/${branch}`,
  `docker compose -f compose.server.yml --env-file .env.server up -d --build`,
  `docker image prune -f`
].join(' && ')

console.log(`\nDeploy target: ${host}:${repoPath} @ origin/${branch} (${remote.slice(0, 8)})`)
console.log(`Remote command:\n  ${remoteScript}\n`)

if (dryRun) {
  console.log('--dry-run: not executing.')
  process.exit(0)
}

run('ssh', [host, remoteScript])
console.log('\nDeploy complete.')
