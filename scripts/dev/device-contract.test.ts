/**
 * The device sync payload is parsed **by hand in Kotlin**, so nothing in either
 * language's type system connects the two ends of it: the server emits
 * `deviceAlarmSchema` / `deviceAgendaEntrySchema` (Zod), and `SyncClient.parseAlarm` /
 * `AgendaEntry.fromJson` pick fields out of a `JSONObject` by string. Rename or add a
 * field on the server and both sides still compile — the device just quietly loses it,
 * which on the alarm path means an alarm that rings with the wrong fidelity and on the
 * agenda path a car list missing whatever was added.
 *
 * `npm run validate` can't see Kotlin and `npm run verify:android` can't see the schema,
 * so this is the only place the seam is checked at all. Same reason the repo already
 * tests `env.ts` against the compose file: a contract split across two toolchains needs
 * a test that reads both.
 *
 * It reads the Kotlin as text on purpose — the alternative is compiling it, which is
 * what the Android build already does for everything a compiler *can* catch.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deviceAgendaEntrySchema, deviceAlarmSchema } from '../../packages/shared/src/device-alarms.js'

/** Every `json.optX("name")` / `json.has("name")` key read in a Kotlin source. */
function keysReadBy(file: string): Set<string> {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  const keys = new Set<string>()
  for (const match of source.matchAll(/json\.(?:opt\w+|has|get\w+)\("([^"]+)"/g)) keys.add(match[1]!)
  return keys
}

/** Every `.put("name", …)` key a Kotlin source writes back out. */
function keysWrittenBy(file: string): Set<string> {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  const keys = new Set<string>()
  for (const match of source.matchAll(/\.put\("([^"]+)"/g)) keys.add(match[1]!)
  return keys
}

test('the native alarm parser reads every field the server sends', () => {
  const sent = Object.keys(deviceAlarmSchema.shape)
  const read = keysReadBy('apps/mobile/android-plugin/SyncClient.kt')
  const missed = sent.filter((key) => !read.has(key))
  assert.deepEqual(
    missed,
    [],
    `SyncClient.parseAlarm ignores DeviceAlarm field(s): ${missed.join(', ')} — the device would arm an alarm without them`
  )
})

test('the native agenda parser reads every field the server sends', () => {
  const sent = Object.keys(deviceAgendaEntrySchema.shape)
  const read = keysReadBy('apps/mobile/android-plugin/AgendaStore.kt')
  const missed = sent.filter((key) => !read.has(key))
  assert.deepEqual(
    missed,
    [],
    `AgendaEntry.fromJson ignores DeviceAgendaEntry field(s): ${missed.join(', ')} — the car list would silently drop them`
  )
})

test('the agenda round-trips through its own storage', () => {
  // AgendaStore persists what it parsed, so a field it can read but not write is lost on
  // the next process — the same silent loss, one step later.
  const sent = Object.keys(deviceAgendaEntrySchema.shape)
  const written = keysWrittenBy('apps/mobile/android-plugin/AgendaStore.kt')
  const missed = sent.filter((key) => !written.has(key))
  assert.deepEqual(missed, [], `AgendaEntry.toJson drops field(s): ${missed.join(', ')}`)
})

test('neither parser reads a field the server does not send', () => {
  // The reverse drift: a key kept after the server stopped emitting it reads as a default
  // forever, which looks like a working field rather than a dead one.
  for (const [file, schema] of [
    ['apps/mobile/android-plugin/SyncClient.kt', deviceAlarmSchema],
    ['apps/mobile/android-plugin/AgendaStore.kt', deviceAgendaEntrySchema]
  ] as const) {
    const sent = new Set(Object.keys(schema.shape))
    for (const key of keysReadBy(file)) {
      assert.ok(sent.has(key), `${file} reads "${key}", which is not in the shared schema`)
    }
  }
})
