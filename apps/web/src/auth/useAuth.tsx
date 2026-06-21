/**
 * Auth state + actions. Wraps the email-code sign-in flow and exposes the
 * current user. Starts/stops the WebSocket connection with the session.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import type { AuthState, RequestCodeResponse, SessionUser } from '@persistent/shared'
import { apiFetch } from '../lib/apiClient.js'
import { passkeyAuthenticate } from '../native/passkeyClient.js'
import { queryKeys } from '../lib/queryClient.js'
import { startWs, stopWs } from '../lib/wsClient.js'
import { initNative } from '../native/nativeSync.js'

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  requestCode: (email: string) => Promise<RequestCodeResponse>
  verifyCode: (email: string, code: string) => Promise<void>
  loginWithPasskey: () => Promise<void>
  loginWithGoogle: (credential: string) => Promise<void>
  logout: () => Promise<void>
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
      await apiFetch<AuthState>('/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email, code, timeZone: guessTimeZone() })
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
    },
    loginWithPasskey: async () => {
      const begin = await apiFetch<{ options: PublicKeyCredentialRequestOptionsJSON }>(
        '/api/auth/passkey/authenticate/options',
        { method: 'POST' }
      )
      const assertion = await passkeyAuthenticate(begin.options)
      await apiFetch<AuthState>('/api/auth/passkey/authenticate/verify', {
        method: 'POST',
        body: JSON.stringify({ response: assertion })
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
    },
    loginWithGoogle: async (credential) => {
      await apiFetch<AuthState>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, timeZone: guessTimeZone() })
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
    },
    logout: async () => {
      await apiFetch('/api/auth/logout', { method: 'POST' })
      stopWs()
      queryClient.clear()
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
