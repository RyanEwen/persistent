/** Convert the same Joy palette used by the app into concrete, portable native colors. */
import { nativeAppearanceSchema, type NativeAppearance, type NativePalette } from '@persistent/shared'
import { createAppTheme } from '../theme.js'
import { getTheme, type ThemeId, type AppTheme } from '../settings/themes.js'

/** Resolve Joy palette variables against their actual ramp, rather than stale CSS fallbacks. */
function paletteColor(palette: Record<string, unknown>, value: string): string {
  const variable = /^var\(--joy-palette-([a-zA-Z0-9-]+),\s*(.+)\)$/.exec(value)
  if (variable) {
    let resolved: unknown = palette
    for (const key of variable[1]!.split('-')) {
      resolved = resolved && typeof resolved === 'object' ? (resolved as Record<string, unknown>)[key] : undefined
    }
    return paletteColor(palette, typeof resolved === 'string' ? resolved : variable[2]!)
  }
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${[...value.slice(1)].map((digit) => digit + digit).join('')}`
  }
  return value
}

/** Derive native surfaces and semantic actions from one resolved app theme. */
function nativePalette(theme: AppTheme): NativePalette {
  const palette = createAppTheme(theme).colorSchemes[theme.mode].palette
  const resolve = (value: string) => paletteColor(palette as unknown as Record<string, unknown>, value)
  return {
    background: resolve(palette.background.body),
    surface: resolve(palette.background.surface),
    surfacePressed: resolve(palette.neutral.softHoverBg),
    text: resolve(palette.text.primary),
    secondary: resolve(palette.text.secondary),
    border: resolve(palette.neutral.outlinedBorder),
    accent: resolve(palette.primary.solidBg),
    accentPressed: resolve(palette.primary.solidHoverBg),
    onAccent: resolve(palette.primary.solidColor),
    kicker: resolve(palette.primary.plainColor),
    done: resolve(palette.success.solidBg),
    donePressed: resolve(palette.success.solidHoverBg),
    onDone: resolve(palette.success.solidColor)
  }
}

/** Supply both system palettes so closed Android alarms can follow later OS changes. */
export function nativeAppearance(themeId: ThemeId): NativeAppearance {
  const selected = getTheme(themeId)
  return nativeAppearanceSchema.parse({
    version: 1,
    mode: themeId === 'system' ? 'system' : selected.mode,
    light: nativePalette(getTheme(themeId, 'light')),
    dark: nativePalette(getTheme(themeId, 'dark'))
  })
}
