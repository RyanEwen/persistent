#!/usr/bin/env node
/**
 * Wire the custom native AlarmPlugin into the generated Capacitor Android
 * project. Run after `cap add android`; idempotent, so it's safe to re-run after
 * `cap sync` regenerates files.
 *
 * It performs the three manual steps the README used to describe:
 *   1. Copy android-plugin/*.kt into the app's java/ca/persistent/app/alarm/.
 *   2. Merge android-plugin/AndroidManifest.additions.xml into the app manifest
 *      (permissions as <manifest> children, components inside <application>),
 *      guarded by marker comments.
 *   3. Replace the generated MainActivity with one that registers AlarmPlugin.
 *
 * Requires the Android project to exist (a JDK + Android SDK are needed to then
 * build it; this script only edits source files).
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileRoot = join(here, '..')
const pluginDir = join(mobileRoot, 'android-plugin')
const androidApp = join(mobileRoot, 'android', 'app', 'src', 'main')
const appPkgDir = join(androidApp, 'java', 'ca', 'persistent', 'app')
const alarmPkgDir = join(appPkgDir, 'alarm')

const BEGIN_PERMS = '<!-- BEGIN persistent-alarm permissions -->'
const END_PERMS = '<!-- END persistent-alarm permissions -->'
const BEGIN_COMP = '<!-- BEGIN persistent-alarm components -->'
const END_COMP = '<!-- END persistent-alarm components -->'

function fail(message) {
  console.error(`\n[setup-android] ${message}\n`)
  process.exit(1)
}

if (!existsSync(join(mobileRoot, 'android'))) {
  fail("No android/ project found. Run `npx cap add android` first (needs the Android SDK).")
}

// --- 1. Copy the Kotlin sources ---------------------------------------------
mkdirSync(alarmPkgDir, { recursive: true })
const kotlinFiles = readdirSync(pluginDir).filter((f) => f.endsWith('.kt'))
for (const file of kotlinFiles) {
  copyFileSync(join(pluginDir, file), join(alarmPkgDir, file))
}
console.log(`[setup-android] copied ${kotlinFiles.length} Kotlin sources -> ${alarmPkgDir}`)

// --- 2. Merge the manifest additions ----------------------------------------
const manifestPath = join(androidApp, 'AndroidManifest.xml')
if (!existsSync(manifestPath)) fail(`Manifest not found at ${manifestPath}`)

const additions = readFileSync(join(pluginDir, 'AndroidManifest.additions.xml'), 'utf8')
const appMarker = '<!-- ===== inside <application> ===== -->'
const [permsRaw, compsRaw] = additions.split(appMarker)
const permissions = permsRaw
  .split('\n')
  .filter((line) => line.trim().startsWith('<uses-permission') || line.trim().startsWith('<uses-feature'))
  .join('\n')
const components = compsRaw.trim()

let manifest = readFileSync(manifestPath, 'utf8')

function replaceBlock(source, begin, end, body) {
  const block = `${begin}\n${body}\n${end}`
  if (source.includes(begin) && source.includes(end)) {
    const re = new RegExp(`${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}`)
    return source.replace(re, block)
  }
  return null // signal: not yet inserted
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Permissions: refresh existing block, else insert right after the <manifest ...> tag.
const permsBlock = `${BEGIN_PERMS}\n${permissions}\n${END_PERMS}`
const permsReplaced = replaceBlock(manifest, BEGIN_PERMS, END_PERMS, permissions)
if (permsReplaced) {
  manifest = permsReplaced
} else {
  manifest = manifest.replace(/(<manifest\b[^>]*>)/, `$1\n    ${permsBlock.replace(/\n/g, '\n    ')}`)
}

// Components: refresh existing block, else insert right before </application>.
const compsBlock = `${BEGIN_COMP}\n${components}\n${END_COMP}`
const compsReplaced = replaceBlock(manifest, BEGIN_COMP, END_COMP, components)
if (compsReplaced) {
  manifest = compsReplaced
} else {
  manifest = manifest.replace(/(<\/application>)/, `    ${compsBlock.replace(/\n/g, '\n    ')}\n$1`)
}

writeFileSync(manifestPath, manifest)
console.log('[setup-android] merged permissions + components into AndroidManifest.xml')

// --- 3. Register the plugin via MainActivity --------------------------------
mkdirSync(appPkgDir, { recursive: true })
// Remove a generated Kotlin MainActivity if present, to avoid a duplicate class.
const generatedKt = join(appPkgDir, 'MainActivity.kt')
if (existsSync(generatedKt)) rmSync(generatedKt)
copyFileSync(join(pluginDir, 'MainActivity.java'), join(appPkgDir, 'MainActivity.java'))
console.log('[setup-android] installed MainActivity.java (registers AlarmPlugin)')

// --- 4. Enable Kotlin -------------------------------------------------------
// The plugin sources are Kotlin but Capacitor's generated app module is
// Java-only, so apply the Kotlin Gradle plugin (idempotent). Kotlin 1.9.24 is
// compatible with the generated AGP 8.2 / Gradle 8.2 toolchain.
const KOTLIN_VERSION = '1.9.24'
const rootGradlePath = join(mobileRoot, 'android', 'build.gradle')
const appGradlePath = join(mobileRoot, 'android', 'app', 'build.gradle')

let rootGradle = readFileSync(rootGradlePath, 'utf8')
if (!rootGradle.includes('kotlin-gradle-plugin')) {
  rootGradle = rootGradle.replace(
    /(classpath 'com\.android\.tools\.build:gradle:[^']+')/,
    `$1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}'`
  )
  writeFileSync(rootGradlePath, rootGradle)
  console.log('[setup-android] added Kotlin classpath to android/build.gradle')
}

let appGradle = readFileSync(appGradlePath, 'utf8')
if (!appGradle.includes("apply plugin: 'kotlin-android'")) {
  appGradle = appGradle.replace(
    /(apply plugin: 'com\.android\.application'\n)/,
    `$1apply plugin: 'kotlin-android'\n`
  )
  writeFileSync(appGradlePath, appGradle)
  console.log("[setup-android] applied kotlin-android plugin in android/app/build.gradle")
}

console.log('\n[setup-android] done. Next: `npm run sync` then build in Android Studio.\n')
