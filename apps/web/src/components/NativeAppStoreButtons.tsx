/** Shared Google Play and Microsoft Store actions for Persistent's native apps. */
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import AndroidIcon from '@mui/icons-material/Android'
import WindowRoundedIcon from '@mui/icons-material/WindowRounded'
import { PLAY_STORE_URL, WINDOWS_STORE_URL } from './appPromotion.js'

export interface NativeAppStoreButtonsProps {
  showAndroid?: boolean
  showWindows?: boolean
}

/** Render the requested Store links, full-width on phones and compact elsewhere. */
export function NativeAppStoreButtons({
  showAndroid = true,
  showWindows = true
}: NativeAppStoreButtonsProps) {
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {showAndroid && (
        <Button
          component="a"
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noreferrer"
          size="sm"
          variant="outlined"
          startDecorator={<AndroidIcon />}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Google Play
        </Button>
      )}
      {showWindows && (
        <Button
          component="a"
          href={WINDOWS_STORE_URL}
          target="_blank"
          rel="noreferrer"
          size="sm"
          variant="outlined"
          startDecorator={<WindowRoundedIcon />}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Microsoft Store
        </Button>
      )}
    </Stack>
  )
}
