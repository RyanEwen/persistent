/**
 * Enjoy-inspired Joy styling for the shared app, including portalled controls.
 * Reference: https://enjoy.dev/features/styles.css. System font fallbacks follow
 * the reference app; no remote fonts are needed when the device is offline.
 */
import { extendTheme } from '@mui/joy/styles'
import type { ColorPaletteProp, Theme } from '@mui/joy/styles'

const BODY_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const HEADING_FONT = '"Arial Rounded MT Bold", ui-rounded, "SF Pro Rounded", system-ui, sans-serif'

/** Quiet fields use filled surfaces; focus and validation retain visible outlines. */
function fieldStyle(theme: Theme, radius: string, color: ColorPaletteProp = 'neutral') {
  const semantic = color !== 'neutral'

  return {
    borderRadius: radius,
    borderWidth: 0,
    backgroundColor: theme.vars.palette.background.level1,
    boxShadow: semantic ? `inset 0 0 0 1px ${theme.vars.palette[color].outlinedBorder}` : 'none',
    [theme.getColorSchemeSelector('light')]: {
      backgroundColor: theme.vars.palette.background.level2
    }
  }
}

/** Keep the reference surface colors separate from semantic action colors. */
const SURFACES = {
  light: {
    canvas: '#fafaf9', panel: '#ffffff', field: '#f0f0eb', hover: '#e5e5df',
    border: '#e5e5df', fieldBorder: '#cdcec5', strong: '#242523', text: '#353630',
    muted: '#72736d', secondary: '#5e6058', accent: '#2454a0', accentHover: '#1e4788',
    accentActive: '#183969', accentInk: '#ffffff', accentSoft: '#e8eef7',
    accentSoftHover: '#dce6f4', accentText: '#2454a0', scrim: '#00000066'
  },
  dark: {
    canvas: '#191a1d', panel: '#242529', field: '#2c2d31', hover: '#36373b',
    border: '#36373b', fieldBorder: '#46484d', strong: '#f2f0eb', text: '#e3e2dd',
    muted: '#aeafa8', secondary: '#c4c5bd',
    // Deepen the source blue slightly so white action labels meet 4.5:1 contrast.
    accent: '#226bd4', accentHover: '#1c5bb7', accentActive: '#174b99',
    accentInk: '#ffffff', accentSoft: '#27344c', accentSoftHover: '#304363',
    accentText: '#9cc2ff', scrim: '#00000080'
  }
}

/** Explicit neutral states keep fields, quiet controls, and native exports aligned. */
function enjoyPalette(mode: keyof typeof SURFACES) {
  const color = SURFACES[mode]
  const dark = mode === 'dark'

  return {
    neutral: {
      50: '#fafaf9', 100: '#f0f0eb', 200: '#e5e5df', 300: '#cdcec5',
      400: '#aeafa8', 500: '#72736d', 600: '#5e6058', 700: '#46484d',
      800: '#36373b', 900: '#242529',
      plainColor: color.secondary,
      plainHoverBg: color.field,
      plainActiveBg: color.hover,
      outlinedColor: color.text,
      outlinedBorder: color.fieldBorder,
      outlinedHoverBg: color.field,
      outlinedActiveBg: color.hover,
      softColor: color.text,
      softBg: color.field,
      softHoverBg: color.hover,
      softActiveBg: color.fieldBorder
    },
    primary: {
      300: '#9cc2ff', 400: '#719bd6', 500: color.accentText, 600: '#226bd4', 700: '#2454a0',
      800: '#27344c', 900: '#202a3d',
      solidColor: color.accentInk,
      solidBg: color.accent,
      solidHoverBg: color.accentHover,
      solidActiveBg: color.accentActive,
      plainColor: color.accentText,
      plainHoverBg: color.accentSoft,
      plainActiveBg: color.accentSoftHover,
      outlinedColor: color.accentText,
      outlinedBorder: dark ? '#587ec1' : '#719bd6',
      outlinedHoverBg: color.accentSoft,
      outlinedActiveBg: color.accentSoftHover,
      softColor: color.accentText,
      softBg: color.accentSoft,
      softHoverBg: color.accentSoftHover,
      softActiveBg: color.accentSoftHover
    },
    text: { primary: color.text, secondary: color.secondary, tertiary: color.muted },
    background: {
      body: color.canvas, surface: color.panel, popup: color.panel,
      level1: color.field, level2: color.hover, level3: color.fieldBorder,
      backdrop: color.scrim
    },
    divider: color.border,
    focusVisible: dark ? '#9cc2ff' : '#2454a0',
    // Done retains its solid green emphasis; warm warning/error tints stay distinct.
    success: {
      solidBg: dark ? '#8fc6a7' : '#386244',
      solidHoverBg: dark ? '#7bb996' : '#2d5037',
      solidActiveBg: dark ? '#69a885' : '#24422d',
      solidColor: dark ? '#191a1d' : '#ffffff',
      plainColor: dark ? '#8fc6a7' : '#386244',
      softColor: dark ? '#b4ddc5' : '#386244',
      softBg: dark ? '#25372d' : '#edf5ed'
    },
    danger: {
      plainColor: dark ? '#efb8ac' : '#9d4531',
      outlinedColor: dark ? '#efb8ac' : '#9d4531',
      softColor: dark ? '#efb8ac' : '#8f3f29',
      softBg: dark ? '#35292a' : '#fff0e8'
    },
    warning: {
      plainColor: dark ? '#ffd392' : '#9b4a10',
      outlinedColor: dark ? '#ffd392' : '#9b4a10',
      softColor: dark ? '#ffd392' : '#9b4a10',
      softBg: dark ? '#342d25' : '#fff2df'
    }
  }
}

/** Build both schemes so Joy controls share one complete style profile. */
export function createEnjoyTheme() {
  const heading = { fontFamily: HEADING_FONT, letterSpacing: '-0.025em', fontWeight: 700 }

  return extendTheme({
    colorSchemes: {
      light: { palette: enjoyPalette('light') },
      dark: { palette: enjoyPalette('dark') }
    },
    fontFamily: { body: BODY_FONT, display: HEADING_FONT },
    radius: { xs: '6px', sm: '11px', md: '12px', lg: '20px', xl: '28px' },
    shadow: {
      xs: '0 1px 2px rgba(0, 0, 0, 0.08)',
      sm: '0 1px 3px rgba(0, 0, 0, 0.08)',
      md: '0 10px 24px rgba(0, 0, 0, 0.12)',
      lg: '0 12px 40px rgba(0, 0, 0, 0.2)',
      xl: '0 15px 55px rgba(0, 0, 0, 0.3)'
    },
    typography: {
      h1: heading, h2: heading, h3: heading, h4: heading,
      'title-lg': heading, 'title-md': heading, 'title-sm': heading
    },
    components: {
      JoyCard: { styleOverrides: { root: { borderRadius: '20px', borderWidth: 0, boxShadow: 'var(--joy-shadow-xs)' } } },
      JoyButton: {
        styleOverrides: {
          root: ({ theme, ownerState }) => ({
            borderRadius: '11px',
            fontWeight: 600,
            ...(ownerState.variant === 'outlined' ? {
              borderWidth: 0,
              backgroundColor: theme.vars.palette.neutral.softBg
            } : {}),
            '&[aria-pressed="true"]': { boxShadow: `inset 0 0 0 1px ${theme.vars.palette.primary.outlinedBorder}` }
          })
        }
      },
      JoyIconButton: { styleOverrides: { root: { borderRadius: '11px', borderWidth: 0 } } },
      JoyInput: {
        styleOverrides: {
          root: ({ theme, ownerState }) => fieldStyle(theme, '12px', ownerState.color)
        }
      },
      JoyAutocomplete: {
        styleOverrides: {
          root: ({ theme, ownerState }) => fieldStyle(theme, '12px', ownerState.color),
          listbox: { borderRadius: '12px', borderWidth: 0, boxShadow: 'var(--joy-shadow-lg)' }
        }
      },
      JoyTextarea: {
        styleOverrides: {
          root: ({ theme, ownerState }) => fieldStyle(theme, '16px', ownerState.color)
        }
      },
      JoySelect: {
        styleOverrides: {
          root: ({ theme, ownerState }) => fieldStyle(theme, '12px', ownerState.color),
          listbox: { borderRadius: '12px', borderWidth: 0, boxShadow: 'var(--joy-shadow-lg)' }
        }
      },
      JoyMenu: { styleOverrides: { root: { borderRadius: '12px', borderWidth: 0, boxShadow: 'var(--joy-shadow-lg)' } } },
      JoyModalDialog: { styleOverrides: { root: { borderRadius: '28px', borderWidth: 0, boxShadow: 'var(--joy-shadow-xl)' } } },
      JoyTooltip: { styleOverrides: { root: { borderRadius: '11px' } } },
      JoyChip: { styleOverrides: { root: { borderRadius: '999px' } } }
    }
  })
}
