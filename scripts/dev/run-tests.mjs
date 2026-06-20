#!/usr/bin/env node
/**
 * Test runner: discovers every `*.test.ts` under apps/ and packages/ and runs
 * them through Node's built-in test runner with the tsx loader (so we test the
 * TypeScript sources directly, no build step).
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOTS = ['apps', 'packages']
const IGNORE = new Set(['node_modules', 'dist', '.vite', 'android', 'ios'])

function findTests(dir, out) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (IGNORE.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      findTests(full, out)
    } else if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
}

const tests = []
for (const root of ROOTS) findTests(root, tests)

if (tests.length === 0) {
  console.log('No test files found.')
  process.exit(0)
}

const result = spawnSync(
  'node',
  ['--import', 'tsx', '--test', ...tests],
  { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } }
)

process.exit(result.status ?? 1)
