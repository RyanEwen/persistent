/**
 * App bootstrap: register the auto-updating service worker, then mount React
 * with the Joy theme, TanStack Query, auth, and the router.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CssVarsProvider } from '@mui/joy/styles'
import CssBaseline from '@mui/joy/CssBaseline'
import GlobalStyles from '@mui/joy/GlobalStyles'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { theme } from './theme.js'
import { queryClient, registerMutationDefaults } from './lib/queryClient.js'
import { persistOptions } from './lib/persistQuery.js'
import { AuthProvider } from './auth/useAuth.js'
import { SettingsProvider } from './settings/useSettings.js'
import { ToastProvider } from './components/ToastProvider.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { App } from './App.js'

// Auto-apply SW updates so stale code never lingers in long-lived PWA installs.
registerSW({ immediate: true })

// Mutation defaults must exist before any persisted offline mutation resumes.
registerMutationDefaults()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <React.StrictMode>
    <CssVarsProvider theme={theme} defaultMode="dark">
      <CssBaseline />
      {/* Scale all rem-based typography up 10% overall. */}
      <GlobalStyles styles={{ html: { fontSize: '110%' } }} />
      <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
        onSuccess={() => {
          // Once the cache is restored, replay anything queued while offline.
          void queryClient.resumePausedMutations()
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <SettingsProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </SettingsProvider>
          </AuthProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
      </ErrorBoundary>
    </CssVarsProvider>
  </React.StrictMode>
)
