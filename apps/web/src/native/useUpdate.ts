/**
 * Update checking against GitHub Releases, shared by the on-launch prompt
 * (UpdateCheck.tsx) and the Settings section (UpdateSettings.tsx). On the native
 * app the APK is downloaded + installed in-app via the Update plugin; on the web
 * the service worker handles updates, so this is a no-op there beyond reporting
 * the current version.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { UpdatePlugin, isNative, type UpdateState } from './alarmBridge.js'

const REPO = 'RyanEwen/persistent'
const CURRENT = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export interface ReleaseInfo {
  version: string
  notes: string
  apkUrl: string
}

export type InstallState = 'idle' | 'downloading' | 'failed'

function parts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
}

/** Is semver `a` strictly newer than `b`? */
export function isNewer(a: string, b: string): boolean {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db
  }
  return false
}

export const currentVersion = CURRENT

/** Fetch the latest published release and its APK asset, or null on any failure. */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' }
    })
    if (!r.ok) return null
    const rel = (await r.json()) as {
      tag_name?: string
      body?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const apk = rel.assets?.find((a) => a.name?.endsWith('.apk'))
    if (!apk?.browser_download_url || !rel.tag_name) return null
    return { version: rel.tag_name.replace(/^v/, ''), notes: rel.body ?? '', apkUrl: apk.browser_download_url }
  } catch {
    return null
  }
}

export function useUpdate() {
  const [available, setAvailable] = useState<ReleaseInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedClean, setCheckedClean] = useState(false)
  const [install, setInstall] = useState<InstallState>('idle')

  const check = useCallback(async (): Promise<ReleaseInfo | null> => {
    setChecking(true)
    setCheckedClean(false)
    const rel = await fetchLatestRelease()
    setChecking(false)
    if (rel && isNewer(rel.version, CURRENT)) {
      setAvailable(rel)
      return rel
    }
    setAvailable(null)
    setCheckedClean(true)
    return null
  }, [])

  const start = useCallback(async (rel: ReleaseInfo): Promise<void> => {
    if (!isNative()) {
      window.open(rel.apkUrl, '_blank')
      return
    }
    setInstall('downloading')
    try {
      await UpdatePlugin.downloadAndInstall({ url: rel.apkUrl })
    } catch {
      setInstall('failed')
    }
  }, [])

  useEffect(() => {
    if (!isNative()) return
    let handle: PluginListenerHandle | undefined
    const listener = UpdatePlugin as unknown as {
      addListener: (event: string, cb: (s: UpdateState) => void) => Promise<PluginListenerHandle>
    }
    listener
      .addListener('updateState', (s) => {
        if (s.state === 'failed') setInstall('failed')
        else if (s.state === 'ready') setInstall('idle')
      })
      .then((h) => {
        handle = h
      })
      .catch(() => {})
    return () => {
      handle?.remove()
    }
  }, [])

  return { available, checking, checkedClean, install, check, start, currentVersion: CURRENT }
}
