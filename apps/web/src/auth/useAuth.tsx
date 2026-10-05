/**
 * Auth state + actions. Wraps the email-code sign-in flow and exposes the
 * current user, including bounded offline access to saved personal data. Confirms
 * account ownership before enabling domain requests and the WebSocket connection.
 */
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { extractErrorMessage, type AuthState, type RequestCodeResponse, type SessionUser } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { passkeyAuthenticate } from '../native/passkeyClient.js'
import { queryKeys } from '../lib/queryClient.js'
import { notify } from '../lib/toast.js'
import { startWs, stopWs } from '../lib/wsClient.js'
import { initNative } from '../native/nativeSync.js'
import { readOfflineUser, saveOfflineUser } from './offlineSession.js'
import { loadSession, type LocalSession } from './loadSession.js'
import { setSessionNetwork } from './sessionNetwork.js'
import { acceptSession, clearNativeAlerts, dropSignedOutData } from './sessionData.js'

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  offline: boolean
  error: Error | null
  refreshSession: () => Promise<LocalSession>
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.auth,
    queryFn: async ({ signal }) => {
      setSessionNetwork(false)
      const session = await loadSession(readOfflineUser(window.localStorage), navigator.onLine, signal)
      signal.throwIfAborted()
      return acceptSession(queryClient, session)
    },
    // Session probes must run while all domain requests are suspended.
    networkMode: 'always',
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: false
  })

  const user = data?.user ?? null
  const offline = data?.offline ?? false
  const refreshSession = useCallback(async (): Promise<LocalSession> => {
    const result = await refetch({ cancelRefetch: false })
    if (result.error) throw result.error
    return result.data!
  }, [refetch])

  useEffect(() => {
    setSessionNetwork(Boolean(user) && !offline && !error)
    if (user && !offline && !error) {
      startWs()
      void initNative()
    } else {
      stopWs()
    }
  }, [user, offline, error])

  useEffect(() => {
    // QueryCache and the session error surface report failures from these event probes.
    const refresh = () => { void refreshSession().catch(() => {}) }
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [refreshSession])

  /** Sign-in responses are authoritative and must replace the saved account before opening writes. */
  async function establishSession(result: AuthState): Promise<void> {
    await queryClient.cancelQueries({ queryKey: queryKeys.auth })
    const session = await acceptSession(queryClient, { ...result, offline: false })
    queryClient.setQueryData<LocalSession>(queryKeys.auth, session)
  }

  const value: AuthContextValue = {
    user,
    loading: isPending,
    offline,
    error,
    refreshSession,
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
      await establishSession(result)
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
      await establishSession(result)
    },
    loginWithGoogle: async (credential) => {
      const result = await apiFetch<AuthState>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, timeZone: guessTimeZone() })
      })
      await establishSession(result)
    },
    logout: async () => {
      // Optimistically drop the session so the UI returns to sign-in immediately,
      // regardless of how the network call goes.
      setSessionNetwork(false)
      stopWs()
      await queryClient.cancelQueries()
      await clearNativeAlerts()
      saveOfflineUser(window.localStorage, null)
      queryClient.setQueryData<LocalSession>(queryKeys.auth, { user: null, offline: false })
      dropSignedOutData(queryClient)
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' })
      } catch (error) {
        notify(extractErrorMessage(error, "Couldn't reach the server to sign out."), 'danger')
      }
    },
    refreshAfterDeletion: async () => {
      // The server already destroyed the session and every row behind it, so
      // unlike logout there is nothing to call and nothing that can fail —
      // just tear down local state (including the persisted query cache, which
      // would otherwise leave the deleted account's reminders readable offline).
      setSessionNetwork(false)
      stopWs()
      await queryClient.cancelQueries()
      await clearNativeAlerts()
      saveOfflineUser(window.localStorage, null)
      queryClient.setQueryData<LocalSession>(queryKeys.auth, { user: null, offline: false })
      dropSignedOutData(queryClient)
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
