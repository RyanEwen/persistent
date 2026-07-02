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
import { existsSync, readFileSync, writeFileSync, copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
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

// The components block uses tools:node="remove" (to drop Capacitor's FCM service
// in favour of our FcmService), which needs the tools namespace on <manifest>.
if (!manifest.includes('xmlns:tools=')) {
  manifest = manifest.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"')
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

// --- 4b. Launcher icons -----------------------------------------------------
// Overlay our app icon (the bell, generated from apps/mobile/assets/*.svg into
// android-res/) onto the generated res/, replacing Capacitor's default icon.
const iconOverlay = join(mobileRoot, 'android-res')
if (existsSync(iconOverlay)) {
  cpSync(iconOverlay, join(androidApp, 'res'), { recursive: true })
  console.log('[setup-android] applied custom launcher icons')
}

// --- 4c. Credential Manager (passkeys in the WebView) -----------------------
// androidx.credentials lets PasskeyPlugin bridge WebAuthn to the system passkey
// UI (the WebView has no navigator.credentials).
{
  let g = readFileSync(appGradlePath, 'utf8')
  if (!g.includes('androidx.credentials:credentials')) {
    g = g.replace(
      /dependencies\s*\{/,
      `dependencies {
    implementation "androidx.credentials:credentials:1.3.0"
    implementation "androidx.credentials:credentials-play-services-auth:1.3.0"
    implementation "com.google.android.libraries.identity.googleid:googleid:1.1.1"`
    )
    writeFileSync(appGradlePath, g)
    console.log('[setup-android] added androidx.credentials dependencies')
  }
}

// --- 4d. Firebase Cloud Messaging (FcmService) ------------------------------
// FcmService subclasses @capacitor/push-notifications' MessagingService, so the
// app module needs firebase-messaging on its own compile classpath (the plugin
// declares it `implementation`, which doesn't leak transitively). The version
// tracks the one the push plugin resolves. The google-services plugin still only
// applies when google-services.json is present (handled in the generated
// app/build.gradle), so FCM stays inert until the operator drops that file in.
{
  let g = readFileSync(appGradlePath, 'utf8')
  if (!g.includes('com.google.firebase:firebase-messaging')) {
    g = g.replace(
      /dependencies\s*\{/,
      `dependencies {
    implementation "com.google.firebase:firebase-messaging:23.3.1"`
    )
    writeFileSync(appGradlePath, g)
    console.log('[setup-android] added firebase-messaging dependency')
  }
}

// --- 4e. WorkManager (autonomous background sync) ---------------------------
// SyncWorker keeps the on-device alarm set fresh from the server without the
// WebView or a server push (see docs/alarm-architecture.md); WorkManager isn't a
// default Capacitor dependency, so the app module needs work-runtime on its
// compile classpath. WorkManager self-initializes via androidx-startup (no
// manifest wiring needed).
{
  let g = readFileSync(appGradlePath, 'utf8')
  if (!g.includes('androidx.work:work-runtime')) {
    g = g.replace(
      /dependencies\s*\{/,
      `dependencies {
    implementation "androidx.work:work-runtime-ktx:2.9.1"`
    )
    writeFileSync(appGradlePath, g)
    console.log('[setup-android] added androidx.work (WorkManager) dependency')
  }
}

// --- 5. Release signing (when a keystore is provided via env) ---------------
// Local builds set ANDROID_KEYSTORE_* in .env; CI decodes the keystore secret to
// a file and sets the same vars. Passwords are read by Gradle from the env at
// build time (never written into the project).
const keystoreEnv = process.env.ANDROID_KEYSTORE_FILE
if (keystoreEnv) {
  // Relative keystore paths (local .env) are resolved from the repo root, two
  // levels above apps/mobile; CI passes an absolute path.
  const ksSrc = keystoreEnv.startsWith('/') ? keystoreEnv : join(mobileRoot, '..', '..', keystoreEnv)
  if (existsSync(ksSrc)) {
    copyFileSync(ksSrc, join(mobileRoot, 'android', 'app', 'release.keystore'))
    let g = readFileSync(appGradlePath, 'utf8')
    if (!g.includes('signingConfigs')) {
      g = g.replace(
        /android\s*\{/,
        `android {
    signingConfigs {
        release {
            storeFile file("release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }`
      )
      g = g.replace(/(buildTypes\s*\{\s*\n\s*release\s*\{)/, `$1\n            signingConfig signingConfigs.release`)
      writeFileSync(appGradlePath, g)
      console.log('[setup-android] configured release signing')
    }
  } else {
    console.log(`[setup-android] ANDROID_KEYSTORE_FILE set but not found: ${ksSrc}`)
  }
}

// --- 6. App version from env (CI derives it from the git tag) ----------------
if (process.env.ANDROID_VERSION_NAME || process.env.ANDROID_VERSION_CODE) {
  let g = readFileSync(appGradlePath, 'utf8')
  if (process.env.ANDROID_VERSION_CODE) {
    g = g.replace(/versionCode\s+\d+/, `versionCode ${Number(process.env.ANDROID_VERSION_CODE)}`)
  }
  if (process.env.ANDROID_VERSION_NAME) {
    g = g.replace(/versionName\s+"[^"]*"/, `versionName "${process.env.ANDROID_VERSION_NAME}"`)
  }
  writeFileSync(appGradlePath, g)
  console.log('[setup-android] set app version from env')
}

console.log('\n[setup-android] done. Next: `npm run sync` then build in Android Studio.\n')
