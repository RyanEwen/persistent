/**
 * App shell: a slim top bar with the title, a centered phone-width content
 * column, and a fixed bottom tab bar (Current / Upcoming / History / Settings).
 *
 * The bars carry `env(safe-area-inset-*)` padding so the app can be drawn
 * edge-to-edge on Android: the native side stops insetting the WebView, the app's
 * own background then paints under the status and gesture bars (matching whatever
 * theme is active, instead of the grey window background showing through), and
 * these paddings keep the actual controls clear of them. `viewport-fit=cover` in
 * index.html is what makes the values non-zero.
 *
 * Harmless everywhere else: on desktop browsers and non-notched devices the insets
 * resolve to 0px, so this is a no-op for the PWA.
 */
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Sheet from '@mui/joy/Sheet'
import Typography from '@mui/joy/Typography'
import IconButton from '@mui/joy/IconButton'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { BottomNav } from './BottomNav.js'
import { BrandMark } from './BrandMark.js'
import { GetTheAppButton, NativePromoBanner } from './GetTheApp.js'
import { AlarmPermissionsBanner } from './AlarmPermissionsBanner.js'
import { useSettings } from '../settings/useSettings.js'
import { getTheme, themeSx } from '../settings/themes.js'

export function AppLayout({ children }: { children: ReactNode }) {
  const { themeId } = useSettings()
  const theme = getTheme(themeId)
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.body', ...themeSx(theme) }}>
      <Sheet
        variant="solid"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          px: 2,
          py: 1.5,
          // Grow upward (and sideways, for landscape cutouts) into the system bar
          // rather than sitting under it; the Sheet's own background fills the gap.
          pt: 'calc(12px + env(safe-area-inset-top, 0px))',
          pl: 'calc(16px + env(safe-area-inset-left, 0px))',
          pr: 'calc(16px + env(safe-area-inset-right, 0px))',
          bgcolor: 'background.surface'
        }}
      >
        <Box
          component={RouterLink}
          to="/"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit' }}
        >
          <BrandMark size={26} />
          <Typography level="title-lg">Persistent</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <GetTheAppButton />
        <IconButton
          component={RouterLink}
          to="/help"
          variant="plain"
          color="neutral"
          size="sm"
          aria-label="Help"
          sx={{ ml: 0.5 }}
        >
          <HelpOutlineIcon />
        </IconButton>
      </Sheet>
      {/* pb leaves room for the fixed bottom nav, which is itself taller by the
          gesture-bar inset. */}
      <Box
        sx={{
          maxWidth: 640,
          mx: 'auto',
          px: 2,
          py: 2,
          pb: 'calc(80px + env(safe-area-inset-bottom, 0px))'
        }}
      >
        <AlarmPermissionsBanner />
        <NativePromoBanner />
        {children}
      </Box>
      <BottomNav />
    </Box>
  )
}
