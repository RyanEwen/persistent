/** About card, with migration guidance for the retired direct Android distribution. */
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Stack from '@mui/joy/Stack'
import { DirectBuildNotice } from './DirectBuildNotice.js'
import { hasNativeUpdater, isNative } from './alarmBridge.js'
import { AndroidDownloads } from './AndroidDownloads.js'
import { useAppVersion } from './useAppVersion.js'

/** Choose update guidance by installed capabilities, keeping both Android download choices available. */
function AppUpdateInformation() {
  if (hasNativeUpdater()) return <DirectBuildNotice />
  if (isNative()) {
    return (
      <>
        <Typography level="body-xs">
          You can get updates through Google Play or install newer APKs from GitHub.
        </Typography>
        <AndroidDownloads />
      </>
    )
  }
  return <Typography level="body-xs">This web app updates automatically through your browser.</Typography>
}

export function UpdateSettings() {
  const currentVersion = useAppVersion()

  return (
    <Card variant="outlined">
      <Typography level="title-sm">About</Typography>
      <Typography level="body-sm">Version {currentVersion}</Typography>
      <Stack spacing={1.5}>
        <AppUpdateInformation />
      </Stack>
    </Card>
  )
}
