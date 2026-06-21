/**
 * Joy UI theme. Mobile-first; a calm dark default with a blue accent. Phone
 * widths are the primary target (see docs/ui-conventions.md).
 */
import { extendTheme } from '@mui/joy/styles'

export const theme = extendTheme({
  colorSchemes: {
    dark: {
      palette: {
        primary: {
          solidBg: '#3b82f6',
          solidHoverBg: '#2f6fe0'
        },
        // Joy's default dark "warning" soft reads as muddy brown; use a clean amber
        // so the "needs confirmation" cards look intentional.
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
          body: '#0b0f19',
          surface: '#111726'
        }
      }
    }
  },
  fontFamily: {
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  }
})
