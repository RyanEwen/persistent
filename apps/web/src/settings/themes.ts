/**
 * Selectable app palettes, each with a matching optional doodle color. Historical
 * theme ids stay stable so a newly selected Navy palette survives preference reloads.
 */
import { doodleTile, DOODLE_TILE_CSS_SIZE } from './doodleWallpaper.js'
import { doodleStroke, type DoodleColorId } from './doodleColors.js'
import type { SxProps } from '@mui/joy/styles/types'

export type ThemeId = 'system' | 'doodle' | 'light' | 'dark' | 'forest' | 'plum'

/** Accent (Joy "primary") color ramp; tints buttons, tabs, chips, nav, etc. */
export interface AccentRamp {
  s300: string
  s400: string
  s500: string
  s600: string
  s700: string
  softBg: string
  softColor: string
}

export interface AppTheme {
  id: Exclude<ThemeId, 'system'>
  name: string
  /** Resolved Joy color scheme. Match system chooses one of these palettes. */
  mode: 'light' | 'dark'
  /** Surface palette, independent of wallpaper and primary accent. */
  palette: 'navy' | 'light' | 'charcoal' | 'forest' | 'plum'
  /** Base background color (empty = use the Joy default body color). */
  background: string
  /** Doodle stroke color, used only when the independent wallpaper setting is on. */
  doodleColor: string
  /** Accent ramp; null = keep the app's default primary. */
  accent: AccentRamp | null
}

const TEAL: AccentRamp = {
  s300: '#4fd1a1',
  s400: '#2bc48a',
  s500: '#12b886',
  s600: '#0ca678',
  s700: '#099268',
  softBg: 'rgba(18,184,134,0.16)',
  softColor: '#6ee7b7'
}
const PINK: AccentRamp = {
  s300: '#faa2c1',
  s400: '#f06595',
  s500: '#e64980',
  s600: '#d6336c',
  s700: '#c2255c',
  softBg: 'rgba(230,73,128,0.18)',
  softColor: '#ffc9de'
}

export const APP_THEMES: AppTheme[] = [
  { id: 'light', name: 'Light', mode: 'light', palette: 'light', background: '#f5f5f5', doodleColor: '#bcc4cc', accent: null },
  { id: 'dark', name: 'Dark', mode: 'dark', palette: 'charcoal', background: '#171717', doodleColor: '#414141', accent: null },
  { id: 'doodle', name: 'Navy', mode: 'dark', palette: 'navy', background: '#0b1017', doodleColor: '#2c3e46', accent: TEAL },
  { id: 'forest', name: 'Forest', mode: 'dark', palette: 'forest', background: '#0d1210', doodleColor: '#304b3d', accent: TEAL },
  { id: 'plum', name: 'Plum', mode: 'dark', palette: 'plum', background: '#130f13', doodleColor: '#513c4e', accent: PINK }
]

/** Main appearance choices precede the optional colored palettes. */
export const THEME_OPTIONS: Array<{ id: ThemeId; name: string }> = [
  { id: 'system', name: 'Match system' },
  ...APP_THEMES.map(({ id, name }) => ({ id, name }))
]

export const DEFAULT_THEME_ID: ThemeId = 'system'

/** Preserve saved palettes, including migrating retired navy choices to Navy. */
export function readThemeId(value: unknown): ThemeId {
  if (typeof value === 'string' && ['midnight', 'mint', 'bubblegum', 'plain'].includes(value)) {
    return 'doodle'
  }
  return THEME_OPTIONS.find((option) => option.id === value)?.id ?? DEFAULT_THEME_ID
}

/** Resolve Match system to the traditional palette for the current system scheme. */
export function getTheme(id: ThemeId, systemMode: AppTheme['mode'] = 'light'): AppTheme {
  const selected = id === 'system' ? systemMode : id
  return APP_THEMES.find((theme) => theme.id === selected) ?? APP_THEMES.find((theme) => theme.id === systemMode)!
}

/** Wallpaper only; toggling doodles never changes the selected palette. */
export function themeSx(theme: AppTheme, doodles: boolean, doodleColor: DoodleColorId): SxProps {
  return {
    ...(theme.background ? { backgroundColor: theme.background } : {}),
    ...(doodles
      ? {
          backgroundImage: doodleTile(doodleStroke(theme, doodleColor)),
          backgroundSize: `${DOODLE_TILE_CSS_SIZE}px ${DOODLE_TILE_CSS_SIZE}px`,
          backgroundAttachment: 'fixed'
        }
      : { backgroundImage: 'none' })
  }
}
