/**
 * How the Windows tray app itself behaves: whether it starts with Windows, whether
 * its window stays open, and how large it opens. Plus the way into the native
 * window that keeps what cannot live in here.
 */
import Card from '@mui/joy/Card'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Switch from '@mui/joy/Switch'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import FormHelperText from '@mui/joy/FormHelperText'
import { openHostSettingsWindow } from '../desktopBridge.js'
import type { HostSettingsProps } from './types.js'

export function DesktopAppCard({ settings, update }: HostSettingsProps) {
  return (
    <Card variant="outlined">
      <Typography level="title-sm">Windows app</Typography>

      <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <FormLabel>Start at sign-in</FormLabel>
          <Typography level="body-xs">
            Keeps Persistent in the notification area. Off means no tray icon, and no Windows notifications, until
            you launch it.
          </Typography>
        </Box>
        <Switch checked={settings.startAtSignIn} onChange={(e) => update({ startAtSignIn: e.target.checked })} />
      </FormControl>

      <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <FormLabel>Keep the window open</FormLabel>
          <Typography level="body-xs">
            Normally it closes when you click elsewhere. Pin it while you're writing a reminder so a stray click
            doesn't lose your work.
          </Typography>
        </Box>
        <Switch checked={settings.pinFlyout} onChange={(e) => update({ pinFlyout: e.target.checked })} />
      </FormControl>

      <FormControl>
        <FormLabel>Window size</FormLabel>
        <Select
          value={settings.flyoutSize}
          onChange={(_e, value) => value !== null && update({ flyoutSize: value })}
        >
          {settings.flyoutSizes.map((size) => (
            // `label` explicitly, because the children here are an array rather
            // than a plain string and Joy falls back to reading the option's
            // rendered text to label the closed button.
            <Option key={size.id} value={size.id} label={size.label}>
              {size.label} ({size.width} x {size.height})
            </Option>
          ))}
        </Select>
        <FormHelperText>How large this window opens from the notification area.</FormHelperText>
      </FormControl>

      <Box>
        <Typography level="body-xs" sx={{ mb: 1 }}>
          The server this app connects to, the version it's running, its log folder and the theme of its own window
          are in a separate window, because you may need them when this page can't load.
        </Typography>
        <Button variant="outlined" color="neutral" size="sm" onClick={openHostSettingsWindow}>
          More Windows app settings
        </Button>
      </Box>
    </Card>
  )
}
