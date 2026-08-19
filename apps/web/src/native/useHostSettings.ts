/**
 * The Windows tray app's own settings, read and written from this page.
 *
 * The host owns them (they live in its settings.json, per machine); this hook is
 * only a view onto them, which is why nothing here is persisted or cached. It
 * returns null until the host answers, and forever on every other host. See
 * `requestHostSettings` for why silence is also the version check.
 *
 * Writes are optimistic and then corrected: the control moves at once, the host
 * applies what it can, and its reply is authoritative. That matters for
 * `startAtSignIn`, which Windows can refuse outright.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  onHostMessage,
  requestHostSettings,
  writeHostSettings,
  type HostSettings,
  type HostSettingsPatch
} from './desktopBridge.js'

export interface HostSettingsState {
  /** Null until the host has answered, and on any host that never will. */
  settings: HostSettings | null
  update: (patch: HostSettingsPatch) => void
}

export function useHostSettings(): HostSettingsState {
  const [settings, setSettings] = useState<HostSettings | null>(null)

  useEffect(() => {
    // Handled with an explicit check rather than a fall-through, like every other
    // host-message subscriber (see `useNativeBack.ts` for what that once cost).
    const unsubscribe = onHostMessage((message) => {
      if (message.type === 'hostSettings') setSettings(message.settings)
      // The flyout was just reopened, so this page may have been frozen for days
      // (`lib/swUpdate.ts` acts on the same message). Ask again, because
      // `startAtSignIn` is live OS state and the user can turn the app off in Task
      // Manager while the page is suspended — the exact case that setting reports
      // the OS rather than a stored flag for. The React tree survives a suspend, so
      // the mount below happens once and would never re-ask on its own.
      if (message.type === 'checkForUpdate') requestHostSettings()
    })
    requestHostSettings()
    return unsubscribe
  }, [])

  const update = useCallback((patch: HostSettingsPatch) => {
    setSettings((current) => (current ? { ...current, ...patch } : current))
    writeHostSettings(patch)
  }, [])

  return { settings, update }
}
