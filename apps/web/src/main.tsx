/**
 * App bootstrap: register the auto-updating service worker, then mount React
 * with the Joy theme, TanStack Query, auth, and the router.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CssVarsProvider } from '@mui/joy/styles'
import CssBaseline from '@mui/joy/CssBaseline'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { theme } from './theme.js'
import { queryClient } from './lib/queryClient.js'
import { AuthProvider } from './auth/useAuth.js'
import { App } from './App.js'

// Auto-apply SW updates so stale code never lingers in long-lived PWA installs.
registerSW({ immediate: true })

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <React.StrictMode>
    <CssVarsProvider theme={theme} defaultMode="dark">
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </CssVarsProvider>
  </React.StrictMode>
)
