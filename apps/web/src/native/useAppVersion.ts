/** Report the installed native shell version, independently of the hosted web UI version. */
import { useEffect, useState } from 'react'
import { NativeApp, isNative } from './alarmBridge.js'

const WEB_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/** Prefer the installed APK version; fall back to the web version when native metadata is unavailable. */
async function resolveAppVersion(): Promise<string> {
  if (isNative()) {
    try {
      const info = await NativeApp.getInfo()
      if (info?.version) return info.version
    } catch {
      // Version display must not prevent opening Settings.
    }
  }
  return WEB_VERSION
}

export function useAppVersion(): string {
  const [version, setVersion] = useState(WEB_VERSION)
  useEffect(() => {
    let cancelled = false
    void resolveAppVersion().then((resolved) => {
      if (!cancelled) setVersion(resolved)
    })
    return () => { cancelled = true }
  }, [])
  return version
}
