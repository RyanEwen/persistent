/** Equal download choices for the same Android app, in the migration notice and Settings. */
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'

export function AndroidDownloads() {
  return (
    <Stack spacing={1}>
      <Button component="a" variant="outlined" color="neutral" href="https://github.com/RyanEwen/persistent/releases/latest">
        Download APK from GitHub
      </Button>
      <Button component="a" variant="outlined" color="neutral" href="https://play.google.com/store/apps/details?id=ca.dynamicsolutions.persistent">
        Get it from Google Play
      </Button>
    </Stack>
  )
}
