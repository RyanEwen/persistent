/** Hide stale pages during first load and foreground refresh without discarding open dialogs or drafts. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Stack, Typography } from '@mui/joy'
import { useAuth } from '../auth/useAuth.js'
import { isNative } from '../native/alarmBridge.js'
import { onHostMessage } from '../native/desktopBridge.js'
import { AppLoading } from './AppLoading.js'
import { StartupDataContext } from './startupDataContext.js'

export function StartupDataGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { offline, refreshSession } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const generation = useRef(0)

  /** Join active page requests, including cache hits, after restoring and confirming the account. */
  const refresh = useCallback(async (checkSession: boolean) => {
    const current = ++generation.current
    setLoading(true)
    setError(false)
    try {
      const sessionOffline = checkSession ? (await refreshSession()).offline : offline
      if (!sessionOffline) {
        await queryClient.resumePausedMutations()
        await queryClient.refetchQueries({
          type: 'active',
          predicate: (query) => query.queryKey[0] !== 'auth'
        }, { cancelRefetch: false, throwOnError: true })
      }
    } catch {
      // QueryCache reports the underlying failure. Keep stale content hidden
      // and give the user a visible retry instead of treating an HTTP error as offline.
      if (current === generation.current) setError(true)
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [queryClient, offline, refreshSession])

  // Connection changes must cover cached content before the next paint. Query
  // refresh itself waits for child observers to mount in the passive effect.
  useLayoutEffect(() => { setLoading(true) }, [refresh])

  useEffect(() => {
    void refresh(false)
    const requests = generation
    return () => { requests.current++ }
  }, [refresh])

  useEffect(() => {
    let disposed = false
    let nativeListener: PluginListenerHandle | undefined
    const resume = () => { void refresh(true) }
    const visible = () => {
      if (document.visibilityState === 'visible') {
        resume()
      } else {
        // Prepare the waiting surface before a native host freezes the page.
        generation.current++
        setLoading(true)
      }
    }
    document.addEventListener('visibilitychange', visible)
    const removeHostListener = onHostMessage((message) => {
      if (message.type === 'checkForUpdate') resume()
    })
    if (isNative()) {
      void CapacitorApp.addListener('resume', resume).then((listener) => {
        if (disposed) void listener.remove()
        else nativeListener = listener
      })
    }
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', visible)
      removeHostListener()
      void nativeListener?.remove()
    }
  }, [refresh])

  return (
    <StartupDataContext.Provider value={!loading && !error}>
      {loading && <AppLoading />}
      {error && (
        <Stack spacing={2} sx={{ p: 3 }}>
          <Typography>Could not refresh your reminders.</Typography>
          <Button variant="soft" onClick={() => { void refresh(true) }}>Retry</Button>
        </Stack>
      )}
      {/* Pages must mount to register their queries. Hidden keeps their cached
          content out of both the screen and accessibility tree until refresh settles. */}
      <div hidden={loading || error}>
        {offline && (
          <Alert color="warning" variant="soft" sx={{ m: 2 }}>
            Offline. Showing saved reminders. Changes will sync when you reconnect.
            <Button variant="plain" size="sm" color="neutral" onClick={() => { void refresh(true) }}>Reconnect</Button>
          </Alert>
        )}
        {children}
      </div>
    </StartupDataContext.Provider>
  )
}
