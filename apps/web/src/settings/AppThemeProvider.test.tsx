/** Theme changes must reach portals without remounting drafts or losing saved choices. */
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { JSDOM } from 'jsdom'
import { doodleColorOptions, type DoodleColorId } from './doodleColors.js'
import { APP_THEMES, THEME_OPTIONS, themeSx } from './themes.js'

const require = createRequire(import.meta.url)

// Match Vite's default-import handling for Joy's CommonJS component exports.
const { AppThemeProvider } = require('./AppThemeProvider.tsx') as typeof import('./AppThemeProvider.js')
const { SettingsProvider, useSettings } = require('./useSettings.tsx') as typeof import('./useSettings.js')
const { useAppTheme } = require('./useAppTheme.ts') as typeof import('./useAppTheme.js')
const { useTheme, useColorScheme } = require('@mui/joy/styles') as typeof import('@mui/joy/styles')

/** Mount real device settings and Joy contexts against a selected saved preference. */
async function mountTheme(context: TestContext, stored: Record<string, unknown> | null, darkSystem = true, desktop = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const hostMessages: unknown[] = []
  if (desktop) {
    Object.defineProperty(dom.window, 'chrome', { value: {
      webview: { postMessage: (message: unknown) => hostMessages.push(message) }
    } })
  }
  const previous = new Map<string, PropertyDescriptor | undefined>()
  const globals = {
    React,
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true
  }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  const mediaListeners = new Set<(event: { matches: boolean }) => void>()
  const media = {
    get matches() { return darkSystem },
    addListener(listener: (event: { matches: boolean }) => void) { mediaListeners.add(listener) },
    removeListener(listener: (event: { matches: boolean }) => void) { mediaListeners.delete(listener) }
  }
  Object.defineProperty(dom.window, 'matchMedia', { value: () => media })
  if (stored) dom.window.localStorage.setItem('persistent-settings', JSON.stringify(stored))
  dom.window.localStorage.setItem('joy-mode', 'dark')

  let root = createRoot(dom.window.document.getElementById('root')!)
  context.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  })

  function PortalProbe() {
    const theme = useTheme()
    const { themeId, doodles, doodleColor } = useSettings()
    const selected = useAppTheme()
    const wallpaper = themeSx(selected, doodles, doodleColor) as Record<string, string>
    const { mode, systemMode } = useColorScheme()
    const effectiveMode = mode === 'system' ? systemMode : mode
    const palette = theme.colorSchemes[effectiveMode === 'light' ? 'light' : 'dark'].palette
    return <div id="portal" data-theme={themeId} data-mode={effectiveMode} data-requested-mode={mode} data-surface={palette.background.surface} data-accent={palette.primary.solidBg} data-doodles={doodles} data-doodle-color={doodleColor} data-wallpaper={wallpaper.backgroundImage} data-ink-options={doodleColorOptions(selected).map((option) => option.name).join(",")}>
      <input aria-label="Dialog draft" defaultValue="Unsent draft" />
    </div>
  }

  function Controls() {
    const { setThemeId, doodles, setDoodles, setDoodleColor } = useSettings()
    return <>
      {THEME_OPTIONS.map((theme) => <button key={theme.id} onClick={() => setThemeId(theme.id)}>{theme.id}</button>)}
      <button onClick={() => setDoodles(!doodles)}>Toggle doodles</button>
      <button onClick={() => setDoodleColor('purple')}>Purple doodles</button>
      {createPortal(<PortalProbe />, document.body)}
    </>
  }

  await act(async () => root.render(<SettingsProvider><AppThemeProvider><Controls /></AppThemeProvider></SettingsProvider>))
  const portal = dom.window.document.getElementById('portal')!
  const toggleDoodles = async () => {
    const button = [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent === 'Toggle doodles')!
    await act(async () => button.click())
  }
  const purpleDoodles = async () => {
    const button = [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent === 'Purple doodles')!
    await act(async () => button.click())
  }
  const setSystemDark = async (value: boolean) => {
    await act(async () => {
      darkSystem = value
      for (const listener of mediaListeners) listener(media)
    })
  }
  const selectTheme = async (id: string) => {
    const button = [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent === id)!
    await act(async () => button.click())
  }
  /** Reopen with the preferences actually saved by the previous provider instance. */
  const reload = async () => {
    await act(async () => root.unmount())
    root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => root.render(<SettingsProvider><AppThemeProvider><Controls /></AppThemeProvider></SettingsProvider>))
    return dom.window.document.getElementById('portal')!
  }
  return { dom, portal, toggleDoodles, purpleDoodles, setSystemDark, selectTheme, reload, hostMessages }
}

test('native desktop frame follows fixed themes and system changes without replacing drafts', async (context) => {
  const { portal, hostMessages, selectTheme, setSystemDark } = await mountTheme(context, null, false, true)
  const draft = portal.querySelector('input')!
  draft.value = 'Preserve native-host draft'
  assert.deepEqual(hostMessages.at(-1), { type: 'appearance', mode: 'light', background: '#f5f5f5' })

  await setSystemDark(true)
  assert.deepEqual(hostMessages.at(-1), { type: 'appearance', mode: 'dark', background: '#171717' })
  await selectTheme('forest')
  assert.deepEqual(hostMessages.at(-1), { type: 'appearance', mode: 'dark', background: '#0d1210' })
  const count = hostMessages.length
  await setSystemDark(false)
  assert.equal(hostMessages.length, count, 'A fixed theme must not recolor the host when the OS changes')
  await selectTheme('system')
  assert.deepEqual(hostMessages.at(-1), { type: 'appearance', mode: 'light', background: '#f5f5f5' })
  assert.equal(portal.querySelector('input'), draft)
  assert.equal(draft.value, 'Preserve native-host draft')
})

test('saved palettes and independent doodles reach portals while preserving mounted drafts', async (context) => {
  const { dom, portal, toggleDoodles, purpleDoodles } = await mountTheme(context, { themeId: 'light' })
  const draft = portal.querySelector('input')!
  draft.value = 'Keep this draft'
  assert.equal(portal.dataset.mode, 'light', 'saved app choice overrides stale Joy/system mode')
  assert.equal(portal.dataset.surface, '#ffffff')
  assert.equal(portal.dataset.doodles, 'false')
  await toggleDoodles()
  assert.equal(portal.dataset.doodles, 'true')
  const lightPattern = decodeURIComponent(portal.dataset.wallpaper!)
  assert.match(lightPattern, /stroke='#bcc4cc'/, 'Light uses pale doodle ink')
  await purpleDoodles()
  assert.match(decodeURIComponent(portal.dataset.wallpaper!), /stroke='#cfc4e5'/)
  assert.equal(portal.dataset.surface, '#ffffff', 'ink choices must not recolor surfaces')

  const expectedSurfaces = {
    navy: '#202a38', light: '#ffffff', charcoal: '#222222', forest: '#242e29', plum: '#2e262e'
  }
  for (const theme of APP_THEMES) {
    const button = [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent === theme.id)!
    await act(async () => button.click())
    assert.equal(portal.dataset.doodleColor, 'purple')
    const ink = theme.mode === 'light' ? '#cfc4e5' : '#4a3c60'
    assert.ok(decodeURIComponent(portal.dataset.wallpaper!).includes(`stroke='${ink}'`))
    assert.equal(portal.dataset.doodles, 'true', 'switching palettes must preserve the independent pattern choice')
    assert.notEqual(portal.dataset.wallpaper, 'none')
    assert.equal(portal.dataset.mode, theme.mode)
    assert.equal(dom.window.document.documentElement.getAttribute('data-joy-color-scheme'), theme.mode)
    assert.equal(portal.dataset.surface, expectedSurfaces[theme.palette])
    let expectedAccent = theme.accent?.s500 ?? '#3b82f6'
    if (theme.id === 'light') expectedAccent = 'var(--joy-palette-primary-500, #0B6BCB)'
    if (theme.id === 'dark') expectedAccent = '#2563eb'
    assert.equal(portal.dataset.accent, expectedAccent)
    assert.equal(portal.querySelector('input'), draft, 'changing themes must not remount a dialog')
    assert.equal(draft.value, 'Keep this draft')
    const saved = JSON.parse(dom.window.localStorage.getItem('persistent-settings')!)
    assert.equal(saved.themeId, theme.id)
    assert.equal(saved.doodles, true)
    assert.equal(saved.doodleColor, 'purple')
  }

  const surface = portal.dataset.surface
  const accent = portal.dataset.accent
  await toggleDoodles()
  assert.equal(portal.dataset.wallpaper, 'none')
  assert.equal(portal.dataset.surface, surface)
  assert.equal(portal.dataset.accent, accent)
  assert.equal(portal.querySelector('input'), draft)
  assert.equal(draft.value, 'Keep this draft')
  assert.equal(JSON.parse(dom.window.localStorage.getItem('persistent-settings')!).doodles, false)
})

test('migrates legacy wallpaper choices and honors explicitly saved doodle preferences', async (context) => {
  const cases: Array<{ name: string; stored: Record<string, unknown> | null; expected: boolean; expectedColor?: DoodleColorId }> = [
    { name: 'new device', stored: null, expected: true },
    ...APP_THEMES.map((theme) => ({
      name: `legacy ${theme.id}`,
      stored: { themeId: theme.id },
      expected: ['doodle', 'midnight', 'mint', 'bubblegum'].includes(theme.id)
    })),
    ...['midnight', 'mint', 'bubblegum', 'plain'].map((themeId) => ({
      name: `removed navy variant ${themeId}`,
      stored: { themeId },
      expected: themeId !== 'plain'
    })),
    { name: 'removed variant preserves explicit off', stored: { themeId: 'midnight', doodles: false }, expected: false },
    { name: 'explicitly off on former doodle theme', stored: { themeId: 'doodle', doodles: false }, expected: false },
    { name: 'Navy chosen after migration is kept', stored: { themeId: 'doodle', themeDefaultMigrated: true, doodles: false, doodleColor: 'pink' }, expected: false, expectedColor: 'pink' },
    { name: 'explicitly on with Light', stored: { themeId: 'light', doodles: true }, expected: true },
    { name: 'invalid stored toggle uses legacy choice', stored: { themeId: 'plain', doodles: 'true' }, expected: false },
    { name: 'unknown palette uses the default', stored: { themeId: 'removed' }, expected: true },
    { name: 'saved doodle hue survives reload', stored: { themeId: 'light', doodles: true, doodleColor: 'purple' }, expected: true, expectedColor: 'purple' },
    { name: 'arbitrary ink cannot bypass the shade choices', stored: { themeId: 'light', doodles: true, doodleColor: '#000000' }, expected: true }

  ]
  for (const row of cases) {
    await context.test(row.name, async (childContext) => {
      const { portal } = await mountTheme(childContext, row.stored)
      const storedTheme = row.stored?.themeId
      let expectedTheme = THEME_OPTIONS.find((theme) => theme.id === storedTheme)?.id ?? 'system'
      if (['midnight', 'mint', 'bubblegum', 'plain'].includes(String(storedTheme))) expectedTheme = 'doodle'
      if (row.stored?.themeDefaultMigrated !== true && expectedTheme === 'doodle') expectedTheme = 'system'
      assert.equal(portal.dataset.doodleColor, row.expectedColor ?? 'theme')
      assert.equal(portal.dataset.theme, expectedTheme)
      assert.equal(portal.dataset.doodles, String(row.expected))
      assert.equal(portal.dataset.wallpaper === 'none', !row.expected)
      if (row.stored) {
        const migrated = JSON.parse(localStorage.getItem('persistent-settings')!)
        assert.equal(migrated.themeDefaultMigrated, true)
        assert.equal(migrated.themeId, expectedTheme)
      }
    })
  }
})


test('legacy Navy switches once while other settings and a later Navy choice survive reload', async (context) => {
  const alarmSound = { uri: 'content://tones/alarm', title: 'Selected alarm' }
  const { dom, portal, selectTheme, reload } = await mountTheme(context, {
    themeId: 'doodle',
    doodles: false,
    doodleColor: 'purple',
    timeFormat: '24h',
    timeFormatChosen: true,
    alarmSound,
    shadeProminence: 'MINIMIZED'
  })
  assert.equal(portal.dataset.theme, 'system')
  let saved = JSON.parse(dom.window.localStorage.getItem('persistent-settings')!)
  assert.equal(saved.themeId, 'system')
  assert.equal(saved.themeDefaultMigrated, true)
  assert.equal(saved.doodles, false)
  assert.equal(saved.doodleColor, 'purple')
  assert.equal(saved.timeFormat, '24h')
  assert.deepEqual(saved.alarmSound, alarmSound)
  assert.equal(saved.shadeProminence, 'MINIMIZED')

  await selectTheme('doodle')
  const reopened = await reload()
  assert.equal(reopened.dataset.theme, 'doodle')
  assert.equal(reopened.dataset.mode, 'dark')
  saved = JSON.parse(dom.window.localStorage.getItem('persistent-settings')!)
  assert.equal(saved.themeId, 'doodle')
  assert.equal(saved.doodles, false)
  assert.equal(saved.doodleColor, 'purple')
  assert.deepEqual(saved.alarmSound, alarmSound)
})

test('only one Navy palette remains and every ink choice follows the required shade', () => {
  assert.deepEqual(APP_THEMES.map((theme) => theme.name), ['Light', 'Dark', 'Navy', 'Forest', 'Plum'])
  for (const theme of APP_THEMES) {
    for (const option of doodleColorOptions(theme)) {
      const channels = option.color.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16))
      const permitted = theme.mode === 'light'
        ? channels.every((channel) => channel > 128)
        : channels.every((channel) => channel < 128)
      assert.ok(permitted, `${theme.name}: ${option.name} must use ${theme.mode} ink`)
    }
  }
})


test('Match system defaults and live changes apply traditional surfaces and ink without replacing drafts', async (context) => {
  const { dom, portal, setSystemDark, selectTheme } = await mountTheme(context, {
    themeId: 'system', doodles: true, doodleColor: 'purple'
  }, false)
  const draft = portal.querySelector('input')!
  draft.value = 'Keep the dialog draft'
  assert.equal(portal.dataset.requestedMode, 'system')
  assert.equal(portal.dataset.surface, '#ffffff')
  assert.match(decodeURIComponent(portal.dataset.wallpaper!), /stroke='#cfc4e5'/)
  assert.match(portal.dataset.inkOptions!, /Light purple/)

  await setSystemDark(true)
  assert.equal(portal.dataset.mode, 'dark')
  assert.equal(dom.window.document.documentElement.getAttribute('data-joy-color-scheme'), 'dark')
  assert.equal(portal.dataset.surface, '#222222', 'system dark must use charcoal rather than Navy')
  assert.equal(portal.dataset.accent, '#2563eb')
  assert.match(decodeURIComponent(portal.dataset.wallpaper!), /stroke='#4a3c60'/)
  assert.match(portal.dataset.inkOptions!, /Dark purple/)
  assert.equal(JSON.parse(dom.window.localStorage.getItem('persistent-settings')!).themeId, 'system')

  await setSystemDark(false)
  assert.equal(portal.dataset.surface, '#ffffff')
  assert.equal(dom.window.document.documentElement.getAttribute('data-joy-color-scheme'), 'light')
  assert.match(decodeURIComponent(portal.dataset.wallpaper!), /stroke='#cfc4e5'/)
  assert.equal(portal.querySelector('input'), draft)
  assert.equal(draft.value, 'Keep the dialog draft')

  await selectTheme('light')
  await setSystemDark(true)
  assert.equal(portal.dataset.mode, 'light', 'explicit Light stays light when the system changes')
  await selectTheme('dark')
  await setSystemDark(false)
  assert.equal(portal.dataset.mode, 'dark', 'explicit Dark stays dark when the system changes')
  await selectTheme('system')
  assert.equal(portal.dataset.mode, 'light', 'returning to Match system reads the current preference')
  assert.equal(portal.querySelector('input'), draft)
  assert.equal(draft.value, 'Keep the dialog draft')
})

test('new users default to Match system and the main choices lead the list', async (context) => {
  assert.deepEqual(THEME_OPTIONS.slice(0, 3).map((theme) => theme.name), ['Match system', 'Light', 'Dark'])
  const { portal } = await mountTheme(context, null, false)
  assert.equal(portal.dataset.theme, 'system')
  assert.equal(portal.dataset.mode, 'light')
  assert.equal(portal.dataset.surface, '#ffffff')
})
