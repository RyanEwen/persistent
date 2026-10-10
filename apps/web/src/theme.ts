/**
 * Joy palettes shared by every surface, including portals. Muted surface ramps
 * keep colored themes distinct without overwhelming their primary accents.
 */
import { extendTheme } from '@mui/joy/styles'
import type { AppTheme, AccentRamp } from './settings/themes.js'
import { createEnjoyTheme } from './enjoyTheme.js'

/** Neutral ramps feed Joy's text, borders, disabled controls, and hover states. */
const NEUTRALS = {
  light: { 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040', 800: '#262626', 900: '#171717' },
  charcoal: { 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040', 800: '#303030', 900: '#222222' },
  forest: { 50: '#f6f8f7', 100: '#edf2ef', 200: '#d8e2dc', 300: '#c0cdc5', 400: '#a0afa7', 500: '#7d8d84', 600: '#5b6d63', 700: '#3f5147', 800: '#303c35', 900: '#242e29' },
  plum: { 50: '#faf7fa', 100: '#f2edf2', 200: '#e2d9e1', 300: '#cdc1cb', 400: '#afa1ad', 500: '#8d7e8a', 600: '#6d5e6a', 700: '#51434f', 800: '#3d333b', 900: '#2e262e' }
}

/** Preserve the established accent colors while making every state inherit them. */
function primaryPalette(accent: AccentRamp | null) {
  if (!accent) {
    return { solidBg: '#3b82f6', solidHoverBg: '#2f6fe0', solidActiveBg: '#2563eb' }
  }

  return {
    300: accent.s300,
    400: accent.s400,
    500: accent.s500,
    600: accent.s600,
    700: accent.s700,
    solidBg: accent.s500,
    solidHoverBg: accent.s600,
    solidActiveBg: accent.s700,
    softBg: accent.softBg,
    softColor: accent.softColor,
    plainColor: accent.softColor,
    outlinedColor: accent.softColor,
    outlinedBorder: accent.s700,
    // Dark accent interaction backgrounds must belong to this palette as well.
    800: accent.softBg,
    900: accent.softBg
  }
}

/** Build a complete Joy theme; scheme defaults retain semantic success/danger colors. */
export function createAppTheme(appTheme: AppTheme) {
  if (appTheme.palette === 'enjoy') {
    return createEnjoyTheme()
  }

  const neutral = appTheme.palette === 'navy' ? undefined : NEUTRALS[appTheme.palette]
  // Cards need a clear brightness step above the near-black page backgrounds.
  const surface = neutral?.[900] ?? '#202a38'
  const body = appTheme.background || '#0b0f19'

  return extendTheme({
    colorSchemes: {
      light: {
        palette: {
          neutral: NEUTRALS.light,
          // Joy's light blue ramp keeps white button labels readable.
          primary: {},
          background: {
            body: '#f5f5f5',
            surface: '#ffffff',
            popup: '#ffffff',
            backdrop: 'rgba(0, 0, 0, 0.35)'
          }
        }
      },
      dark: {
        palette: {
          ...(neutral ? { neutral } : {}),
          primary: {
            ...primaryPalette(appTheme.accent),
            ...(appTheme.palette === 'charcoal'
              ? { solidBg: '#2563eb', solidHoverBg: '#1d4ed8', solidActiveBg: '#1e40af' }
              : {}),
            // Bright green/pink buttons need dark ink across web and native palettes.
            ...(appTheme.palette === 'forest' || appTheme.palette === 'plum' || appTheme.palette === 'navy'
              ? { solidColor: '#171717' }
              : {})
          },
          // Preserve the existing legible amber warning treatment in dark palettes.
          warning: {
            plainColor: '#fcd34d',
            softColor: '#fde68a',
            softBg: 'rgba(245, 158, 11, 0.14)',
            softHoverBg: 'rgba(245, 158, 11, 0.22)',
            softActiveBg: 'rgba(245, 158, 11, 0.28)',
            outlinedColor: '#fcd34d',
            outlinedBorder: 'rgba(245, 158, 11, 0.4)',
            solidBg: '#d97706',
            solidHoverBg: '#b45f05'
          },
          background: {
            body,
            surface,
            popup: surface,
            // Joy's dark default uses pale ink, which brightens the blurred page.
            backdrop: 'rgba(0, 0, 0, 0.6)'
          }
        }
      }
    },
    fontFamily: {
      body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    }
  })
}
