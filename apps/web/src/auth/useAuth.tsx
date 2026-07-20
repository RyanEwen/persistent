/**
 * Auth state + actions. Wraps the email-code sign-in flow and exposes the
 * current user. Starts/stops the WebSocket connection with the session.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { extractErrorMessage, type AuthState, type RequestCodeResponse, type SessionUser } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { passkeyAuthenticate } from '../native/passkeyClient.js'
import { queryClient, queryKeys } from '../lib/queryClient.js'
import { notify } from '../lib/toast.js'
import { startWs, stopWs } from '../lib/wsClient.js'
import { AlarmPlugin, isNative } from '../native/alarmBridge.js'
import { initNative } from '../native/nativeSync.js'

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  requestCode: (email: string) => Promise<RequestCodeResponse>
  verifyCode: (email: string, code: string) => Promise<void>
  loginWithPasskey: () => Promise<void>
  loginWithGoogle: (credential: string) => Promise<void>
  logout: () => Promise<void>
  /** Drop all local session state after the account was deleted server-side. */
  refreshAfterDeletion: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Drop the signed-out user's cached data, keeping the auth query itself.
 *
 * `queryClient.clear()` would be the obvious call and is a trap: it removes every
 * query *including* `auth`, while `AuthProvider`'s `useQuery` is still mounted and
 * observing it. The observer is left watching a query that no longer exists, so the
 * next `setQueryData(auth, …)` — i.e. the very next sign-in — creates a *new* query
 * the observer never sees. The session is established server-side but the UI stays
 * on the sign-in screen forever, which only looks like a hung request.
 *
 * Removing everything except `auth` drops the departing user's reminders (including
 * from the persisted cache, so they aren't readable offline) while leaving the auth
 * observer bound to a live query.
 */
function dropSignedOutData(): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.auth[0] })
}

/**
 * Cancel every alarm armed on this device for the account being signed out.
 *
 * On-device alarms are scheduled natively and outlive the web session: without
 * this, a reminder belonging to the previous account can still ring after
 * sign-out (and even after it is deleted server-side, since the cancel broadcast
 * only reaches devices that are still signed in as its owner). No-op on the web.
 */
async function clearDeviceAlarms(): Promise<void> {
  if (!isNative()) return
  await AlarmPlugin.cancelAll().catch(() => {})
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.auth,
    queryFn: () => apiFetch<AuthState>('/api/auth/me')
  })

  const user = data?.user ?? null

  useEffect(() => {
    if (user) {
      startWs()
      // Native client: schedule on-device alarms + live re-sync (no-op on web).
      void initNative()
    } else {
      stopWs()
    }
  }, [user])

  const value: AuthContextValue = {
    user,
    loading: isLoading,
    requestCode: (email) =>
      apiFetch<RequestCodeResponse>('/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email })
      }),
    verifyCode: async (email, code) => {
      const result = await apiFetch<AuthState>('/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email, code, timeZone: guessTimeZone() })
      })
      // Seed auth state from the response (authoritative) instead of refetching
      // /me, which can race the just-set session cookie and read back null.
      await queryClient.cancelQueries({ queryKey: queryKeys.auth })
      queryClient.setQueryData<AuthState>(queryKeys.auth, result)
    },
    loginWithPasskey: async () => {
      const begin = await apiFetch<{ options: PublicKeyCredentialRequestOptionsJSON }>(
        '/api/auth/passkey/authenticate/options',
        { method: 'POST' }
      )
      const assertion = await passkeyAuthenticate(begin.options)
      const result = await apiFetch<AuthState>('/api/auth/passkey/authenticate/verify', {
        method: 'POST',
        body: JSON.stringify({ response: assertion })
      })
      await queryClient.cancelQueries({ queryKey: queryKeys.auth })
      queryClient.setQueryData<AuthState>(queryKeys.auth, result)
    },
    loginWithGoogle: async (credential) => {
      const result = await apiFetch<AuthState>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, timeZone: guessTimeZone() })
      })
      await queryClient.cancelQueries({ queryKey: queryKeys.auth })
      queryClient.setQueryData<AuthState>(queryKeys.auth, result)
    },
    logout: async () => {
      // Optimistically drop the session so the UI returns to sign-in immediately,
      // regardless of how the network call goes.
      stopWs()
      await clearDeviceAlarms()
      queryClient.setQueryData<AuthState>(queryKeys.auth, { user: null })
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' })
      } catch (error) {
        notify(extractErrorMessage(error, "Couldn't reach the server to sign out."), 'danger')
      }
      dropSignedOutData()
    },
    refreshAfterDeletion: async () => {
      // The server already destroyed the session and every row behind it, so
      // unlike logout there is nothing to call and nothing that can fail —
      // just tear down local state (including the persisted query cache, which
      // would otherwise leave the deleted account's reminders readable offline).
      stopWs()
      await clearDeviceAlarms()
      queryClient.setQueryData<AuthState>(queryKeys.auth, { user: null })
      dropSignedOutData()
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
