/**
 * Selectable app themes. Each paints the app background; most overlay a subtle
 * tiled "doodle" pattern of reminder glyphs (bell, clock, pill, calendar, check)
 * — WhatsApp-chat-wallpaper style. The doodle theme is the default.
 */
import type { SxProps } from '@mui/joy/styles/types'

export type ThemeId = 'doodle' | 'midnight' | 'mint' | 'bubblegum' | 'plain'

/** Accent (Joy "primary") color ramp; tints buttons, tabs, chips, nav, etc. */
interface AccentRamp {
  s300: string
  s400: string
  s500: string
  s600: string
  s700: string
  softBg: string
  softColor: string
}

export interface AppTheme {
  id: ThemeId
  name: string
  /** Base background color (empty = use the Joy default body color). */
  background: string
  /** Doodle stroke color (rgba, kept low-alpha for subtlety); null = no pattern. */
  doodle: string | null
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
const INDIGO: AccentRamp = {
  s300: '#9db2ff',
  s400: '#7c93ff',
  s500: '#5c7cfa',
  s600: '#4c6ef5',
  s700: '#4263eb',
  softBg: 'rgba(92,124,250,0.18)',
  softColor: '#aebdff'
}
const GREEN: AccentRamp = {
  s300: '#74d99f',
  s400: '#51cf66',
  s500: '#40c057',
  s600: '#37b24d',
  s700: '#2f9e44',
  softBg: 'rgba(64,192,87,0.16)',
  softColor: '#b2f2bb'
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
  { id: 'doodle', name: 'Doodles', background: '#0b141a', doodle: 'rgba(255,255,255,0.05)', accent: TEAL },
  { id: 'midnight', name: 'Midnight', background: '#0d1326', doodle: 'rgba(140,170,255,0.06)', accent: INDIGO },
  { id: 'mint', name: 'Mint', background: '#0b1a15', doodle: 'rgba(120,230,180,0.06)', accent: GREEN },
  { id: 'bubblegum', name: 'Bubblegum', background: '#1a0f1a', doodle: 'rgba(255,150,220,0.06)', accent: PINK },
  { id: 'plain', name: 'Plain', background: '', doodle: null, accent: null }
]

export const DEFAULT_THEME_ID: ThemeId = 'doodle'

export function getTheme(id: ThemeId): AppTheme {
  return APP_THEMES.find((t) => t.id === id) ?? APP_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
}

// Reminder glyphs centered on the origin, so each can be placed and rotated
// independently below.
const GLYPHS: Record<string, string> = {
  clock: `<circle cx='0' cy='0' r='10'/><path d='M0 0 V-7 M0 0 H6'/>`,
  bell: `<path d='M-8 8 C-8 2 -7 -8 0 -8 C7 -8 8 2 8 8 Z'/><path d='M0 -8 V-11'/><path d='M-3 8 a3 3 0 0 0 6 0'/>`,
  pill: `<rect x='-12' y='-5.5' width='24' height='11' rx='5.5'/><path d='M0 -5.5 V5.5'/>`,
  check: `<circle cx='0' cy='0' r='10'/><path d='M-5 0 l3 3 l6 -7'/>`,
  calendar: `<rect x='-13' y='-10' width='26' height='22' rx='3'/><path d='M-13 -3 H13 M-6 -14 V-8 M6 -14 V-8'/>`
}

const TILE = 156
// [glyph, cx, cy, rotation]. Four rows at uniform 39px spacing (so the gap at
// the tile seam matches the internal gap — no blank repeating row), columns
// staggered, each glyph turned a little for a hand-drawn feel.
const PLACEMENTS: [keyof typeof GLYPHS, number, number, number][] = [
  ['clock', 40, 20, -12],
  ['bell', 118, 20, 12],
  ['pill', 20, 59, -35],
  ['calendar', 99, 59, 9],
  ['check', 40, 98, -8],
  ['clock', 118, 98, 16],
  ['calendar', 20, 137, -7],
  ['bell', 99, 137, -15]
]

/** A seamless tile of stroked, slightly-rotated reminder glyphs, as a CSS url(). */
function doodleTile(color: string): string {
  const body = PLACEMENTS.map(
    ([name, x, y, rot]) => `<g transform='translate(${x} ${y}) rotate(${rot})'>${GLYPHS[name]}</g>`
  ).join('')
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}' viewBox='0 0 ${TILE} ${TILE}' ` +
    `fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>` +
    body +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Joy primary CSS-variable overrides for an accent ramp. */
function accentVars(accent: AccentRamp): Record<string, string> {
  return {
    '--joy-palette-primary-300': accent.s300,
    '--joy-palette-primary-400': accent.s400,
    '--joy-palette-primary-500': accent.s500,
    '--joy-palette-primary-600': accent.s600,
    '--joy-palette-primary-700': accent.s700,
    '--joy-palette-primary-solidBg': accent.s500,
    '--joy-palette-primary-solidHoverBg': accent.s600,
    '--joy-palette-primary-solidActiveBg': accent.s700,
    '--joy-palette-primary-softBg': accent.softBg,
    '--joy-palette-primary-softColor': accent.softColor,
    '--joy-palette-primary-plainColor': accent.softColor,
    '--joy-palette-primary-outlinedColor': accent.softColor,
    '--joy-palette-primary-outlinedBorder': accent.s700
  }
}

/** sx for the app shell under the given theme: background + accent tint. */
export function themeSx(theme: AppTheme): SxProps {
  return {
    ...(theme.background ? { backgroundColor: theme.background } : {}),
    ...(theme.doodle
      ? {
          backgroundImage: doodleTile(theme.doodle),
          // Render the 156px tile smaller so the doodles sit closer together (denser).
          backgroundSize: '104px 104px',
          backgroundAttachment: 'fixed'
        }
      : {}),
    ...(theme.accent ? accentVars(theme.accent) : {})
  }
}
