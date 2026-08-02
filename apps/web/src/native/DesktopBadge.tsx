/**
 * Feeds the Windows tray icon's due-count badge. Renders nothing.
 *
 * Mounted inside the signed-in shell (like `UpdateCheck`) rather than called from
 * `App`, because it reads the active-occurrence query: running that for a
 * signed-out visitor would fire a guaranteed 401 and surface a "Couldn't load
 * data" toast on the sign-in screen.
 *
 * On every host but the Windows one this is inert — `reportBadge` returns
 * immediately when there is no WebView2 bridge.
 */
import { useEffect } from 'react'
import { useActiveOccurrences } from '../data/occurrences.js'
import { isDesktopHost, reportBadge } from './desktopBridge.js'

export function DesktopBadge() {
  const { data } = useActiveOccurrences()

  useEffect(() => {
    if (!isDesktopHost()) return
    const occurrences = data ?? []
    reportBadge(
      occurrences.length,
      occurrences.some((occurrence) => occurrence.status === 'ESCALATED')
    )
  }, [data])

  // Signing out unmounts this; clear the badge so the tray doesn't keep showing
  // a count for an account that is no longer open on this PC.
  useEffect(() => {
    if (!isDesktopHost()) return
    return () => reportBadge(0, false)
  }, [])

  return null
}
