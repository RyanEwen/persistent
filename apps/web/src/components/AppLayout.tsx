/**
 * App shell: a slim top bar with the title, a centered phone-width content
 * column, and a fixed bottom tab bar (Current / History / Settings).
 */
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Sheet from '@mui/joy/Sheet'
import Typography from '@mui/joy/Typography'
import { BottomNav } from './BottomNav.js'
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
          bgcolor: 'background.surface'
        }}
      >
        <Typography component={RouterLink} to="/" level="title-lg" sx={{ textDecoration: 'none' }}>
          Persistent
        </Typography>
      </Sheet>
      {/* pb leaves room for the fixed bottom nav. */}
      <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2, pb: 10 }}>{children}</Box>
      <BottomNav />
    </Box>
  )
}
