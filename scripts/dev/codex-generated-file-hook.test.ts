import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  evaluateGeneratedFilePolicy,
  isGeneratedAndroidPath,
  patchTargets
} from './codex-generated-file-hook.mjs'

test('patchTargets returns unique update and delete targets', () => {
  assert.deepEqual(
    patchTargets('*** Update File: src/a.ts\n*** Delete File: src/b.ts\n*** Update File: src/a.ts'),
    ['src/a.ts', 'src/b.ts']
  )
})

test('generated files are denied while ordinary source remains editable', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'persistent-generated-hook-'))
  writeFileSync(path.join(cwd, 'generated.ts'), '/** GENERATED FILE - DO NOT EDIT. */\nexport const value = 1\n')
  writeFileSync(path.join(cwd, 'source.ts'), 'export const value = 1\n')

  const denied = evaluateGeneratedFilePolicy({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd,
    tool_input: { command: '*** Update File: generated.ts\n*** Update File: source.ts' }
  })
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /generated\.ts/)

  const allowed = evaluateGeneratedFilePolicy({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd,
    tool_input: { command: '*** Update File: source.ts' }
  })
  assert.equal(allowed, null)
})

test('generated Capacitor Android paths are denied without requiring a file header', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'persistent-generated-hook-'))
  const androidFile = path.join(repositoryRoot, 'apps', 'mobile', 'android', 'app', 'MainActivity.java')

  assert.equal(isGeneratedAndroidPath(androidFile, repositoryRoot), true)
  assert.equal(isGeneratedAndroidPath(path.join(repositoryRoot, 'apps', 'mobile', 'android-plugin', 'MainActivity.java'), repositoryRoot), false)

  const denied = evaluateGeneratedFilePolicy({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: repositoryRoot,
    tool_input: { command: '*** Update File: apps/mobile/android/app/MainActivity.java' }
  }, repositoryRoot)

  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /apps\/mobile\/android/)
})
