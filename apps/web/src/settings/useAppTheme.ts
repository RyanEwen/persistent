/** Resolve the saved appearance against Joy's live system preference for wallpaper and ink. */
import { useColorScheme } from '@mui/joy/styles'
import { getTheme } from './themes.js'
import { useSettings } from './useSettings.js'

/** Share the provider's system listener so surface and doodle colors always agree. */
export function useAppTheme() {
  const { themeId } = useSettings()
  const { systemMode } = useColorScheme()
  return getTheme(themeId, systemMode ?? 'light')
}
