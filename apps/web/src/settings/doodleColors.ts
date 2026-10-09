/** Curated doodle ink colors, restricted to pale or dark shades by the active theme. */
import type { AppTheme } from './themes.js'

export type DoodleColorId = 'theme' | 'gray' | 'blue' | 'green' | 'pink' | 'purple' | 'amber'

interface DoodleColor {
  id: DoodleColorId
  name: string
  light: string
  dark: string
}

// These shades let light themes use pale ink and dark themes use dark ink.
// The wallpaper applies opacity separately. Theme changes retain the chosen hue.
const DOODLE_COLORS: DoodleColor[] = [
  { id: 'gray', name: 'gray', light: '#bcc4cc', dark: '#3b4652' },
  { id: 'blue', name: 'blue', light: '#b7cee5', dark: '#294b67' },
  { id: 'green', name: 'green', light: '#bdd5c4', dark: '#31513e' },
  { id: 'pink', name: 'pink', light: '#e2c1cf', dark: '#593848' },
  { id: 'purple', name: 'purple', light: '#cfc4e5', dark: '#4a3c60' },
  { id: 'amber', name: 'amber', light: '#e1cfad', dark: '#57492f' }
]

/** Validate persisted values; unknown or malformed values use the theme's own ink. */
export function readDoodleColor(value: unknown): DoodleColorId {
  return DOODLE_COLORS.find((color) => color.id === value)?.id ?? 'theme'
}

/** Offer only the shades appropriate to the theme; ids keep the hue across mode changes. */
export function doodleColorOptions(theme: AppTheme): Array<{ id: DoodleColorId; name: string; color: string }> {
  const shade = theme.mode === 'light' ? 'Light' : 'Dark'
  return [
    { id: 'theme', name: 'Match theme', color: theme.doodleColor },
    ...DOODLE_COLORS.map((color) => ({
      id: color.id,
      name: `${shade} ${color.name}`,
      color: color[theme.mode]
    }))
  ]
}

/** Resolve the selected hue using the active theme's permitted shade. */
export function doodleStroke(theme: AppTheme, id: DoodleColorId): string {
  return DOODLE_COLORS.find((color) => color.id === id)?.[theme.mode] ?? theme.doodleColor
}
