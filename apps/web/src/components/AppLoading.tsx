/** Shared startup surface, keeping cached content hidden until the app can safely show it. */
import { Box, CircularProgress } from '@mui/joy'

export function AppLoading() {
  return (
    <Box role="status" aria-label="Loading reminders" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh' }}>
      <CircularProgress />
    </Box>
  )
}
