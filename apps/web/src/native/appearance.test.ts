/** Native palette exports must match web colors and remain usable without CSS variables. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { nativeAppearanceSchema } from '@persistent/shared'
import { APP_THEMES } from '../settings/themes.js'

const require = createRequire(import.meta.url)
const { nativeAppearance } = require('./appearance.ts') as typeof import('./appearance.js')

/** WCAG contrast for opaque native text and backgrounds. */
function contrast(text: string, background: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((index) => {
      const value = parseInt(color.slice(index, index + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const first = luminance(text)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

test('every app palette exports concrete colors with readable text and actions', () => {
  for (const theme of APP_THEMES) {
    const appearance = nativeAppearance(theme.id)
    assert.equal(appearance.mode, theme.mode)
    const palette = appearance[theme.mode]
    assert.equal(palette.background, theme.background)
    assert.deepEqual(appearance.light, appearance.dark, 'A fixed theme must not follow the OS')
    for (const value of Object.values(palette)) assert.match(value, /^#[0-9a-fA-F]{6}$/)
    for (const [text, background] of [
      [palette.text, palette.background],
      [palette.secondary, palette.background],
      [palette.text, palette.surface],
      [palette.onAccent, palette.accent],
      [palette.onDone, palette.done]
    ]) {
      assert.ok(contrast(text!, background!) >= 4.5, `${theme.name}: ${text} against ${background} must remain readable`)
    }
  }
})

test('Match system provides both palettes for offline native resolution', () => {
  const appearance = nativeAppearance('system')
  assert.equal(appearance.mode, 'system')
  assert.equal(appearance.light.background, '#f5f5f5')
  assert.equal(appearance.dark.background, '#171717')
  assert.equal(appearance.light.surface, '#ffffff')
  assert.equal(appearance.dark.surface, '#222222')
  assert.equal(appearance.dark.secondary, '#d4d4d4', 'Resolve the custom neutral ramp, not the CSS fallback')
})

test('invalid versions and non-color native input are rejected', () => {
  const appearance = nativeAppearance('system')
  assert.equal(nativeAppearanceSchema.safeParse({ ...appearance, version: 2 }).success, false)
  assert.equal(nativeAppearanceSchema.safeParse({ ...appearance, light: { ...appearance.light, background: 'url(example)' } }).success, false)
})
