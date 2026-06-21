/**
 * Update checking against GitHub Releases, shared by the on-launch prompt
 * (UpdateCheck.tsx) and the Settings section (UpdateSettings.tsx). On the native
 * app the APK is downloaded + installed in-app via the Update plugin; on the web
 * the service worker handles updates, so this is a no-op there beyond reporting
 * the current version.
 *
 * "Current version" is the installed APK's versionName (from @capacitor/app), not
 * the web build version — the web is loaded from prod and auto-updates, so only
 * the native shell is what a GitHub release actually replaces.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { apiFetch } from '../lib/apiClient.js'
import { NativeApp, UpdatePlugin, isNative, type UpdateState } from './alarmBridge.js'

const WEB_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

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

/** The installed APK's versionName on native; the web build version otherwise. */
async function resolveCurrentVersion(): Promise<string> {
  if (isNative()) {
    try {
      const info = await NativeApp.getInfo()
      if (info?.version) return info.version
    } catch {
      /* fall back to the web build version */
    }
  }
  return WEB_VERSION
}

/**
 * Fetch the latest release via our own API (which proxies + caches GitHub, so the
 * check is same-origin and avoids GitHub's unauthenticated per-IP rate limit).
 * Returns null when there's no release yet; throws on failure so callers can
 * distinguish "up to date" from "couldn't check".
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  return apiFetch<ReleaseInfo | null>('/api/app/latest-release', { cache: 'no-store' })
}

export function useUpdate() {
  const [available, setAvailable] = useState<ReleaseInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedClean, setCheckedClean] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)
  const [install, setInstall] = useState<InstallState>('idle')
  const [currentVersion, setCurrentVersion] = useState(WEB_VERSION)

  useEffect(() => {
    let cancelled = false
    void resolveCurrentVersion().then((v) => {
      if (!cancelled) setCurrentVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const check = useCallback(async (): Promise<ReleaseInfo | null> => {
    setChecking(true)
    setCheckedClean(false)
    setCheckFailed(false)
    try {
      const [rel, current] = await Promise.all([fetchLatestRelease(), resolveCurrentVersion()])
      setChecking(false)
      if (rel && isNewer(rel.version, current)) {
        setAvailable(rel)
        return rel
      }
      setAvailable(null)
      setCheckedClean(true)
      return null
    } catch {
      setChecking(false)
      setCheckFailed(true)
      return null
    }
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

  return { available, checking, checkedClean, checkFailed, install, check, start, currentVersion }
}
