/**
 * The Windows tray app's settings, shown on this page rather than in a native
 * window of its own.
 *
 * They are host settings, per machine, and they stay the host's to store, but a
 * user looking for "how does this app notify me" goes to Settings, and finding
 * half the answer here and half behind a cog in a differently-styled window made
 * one product look like two. What could not move is the button at the foot of the
 * second card: the server address, the version and update check, the log folder
 * and the theme of the host's own window are all things you need precisely when
 * this page is the thing that is broken, so they stay native.
 *
 * Renders nothing until the host has answered, which is also how it stays quiet on
 * an older desktop build (`useHostSettings.ts`).
 */
import { useHostSettings } from '../useHostSettings.js'
import { DesktopNotificationsCard } from './DesktopNotificationsCard.js'
import { DesktopAppCard } from './DesktopAppCard.js'

export function DesktopSettings() {
  const { settings, update } = useHostSettings()
  if (!settings) return null

  return (
    <>
      <DesktopNotificationsCard settings={settings} update={update} />
      <DesktopAppCard settings={settings} update={update} />
    </>
  )
}
