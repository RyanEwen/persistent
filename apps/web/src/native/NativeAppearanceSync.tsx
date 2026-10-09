/** Mirror display preferences independently of sign-in or reminder synchronization. */
import { useEffect, useMemo } from 'react'
import { useSettings } from '../settings/useSettings.js'
import { useAppTheme } from '../settings/useAppTheme.js'
import { AlarmPlugin, isNative } from './alarmBridge.js'
import { isDesktopHost } from './desktopBridge.js'
import { nativeAppearance } from './appearance.js'

export function NativeAppearanceSync() {
  const { themeId } = useSettings()
  const selected = useAppTheme()
  const appearance = useMemo(() => nativeAppearance(themeId), [themeId])

  useEffect(() => {
    if (!isNative()) return
    void AlarmPlugin.setAppearance({ appearance }).catch((error: unknown) => {
      // Older installed wrappers can host this web bundle before their native update.
      console.warn('Native appearance could not be synchronized.', error)
    })
  }, [appearance])

  useEffect(() => {
    if (!isDesktopHost()) return
    window.chrome?.webview?.postMessage({
      type: 'appearance',
      mode: selected.mode,
      background: appearance[selected.mode].background
    })
  }, [appearance, selected.mode])

  return null
}
