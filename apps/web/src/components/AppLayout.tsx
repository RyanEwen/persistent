/**
 * App shell: a slim top bar with the title and a settings link, and a centered,
 * phone-width content column.
 */
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Sheet from '@mui/joy/Sheet'
import Typography from '@mui/joy/Typography'
import IconButton from '@mui/joy/IconButton'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.body' }}>
      <Sheet
        variant="solid"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          bgcolor: 'background.surface'
        }}
      >
        <Typography component={RouterLink} to="/" level="title-lg" sx={{ textDecoration: 'none' }}>
          Persistent
        </Typography>
        <IconButton component={RouterLink} to="/settings" variant="plain" aria-label="Settings">
          ⚙
        </IconButton>
      </Sheet>
      <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2 }}>{children}</Box>
    </Box>
  )
}
