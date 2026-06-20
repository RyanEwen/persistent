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
