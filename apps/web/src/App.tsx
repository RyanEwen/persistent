/**
 * Top-level routing. Unauthenticated users see the sign-in screen; everyone else
 * gets the app shell (reminders list, editor, settings).
 */
import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import CircularProgress from '@mui/joy/CircularProgress'
import Box from '@mui/joy/Box'
import { useAuth } from './auth/useAuth.js'
import { AppLayout } from './components/AppLayout.js'
import { SignInPage } from './pages/SignInPage.js'
import { RemindersPage } from './pages/RemindersPage.js'
import { ReminderEditorPage } from './pages/ReminderEditorPage.js'
import { HistoryPage } from './pages/HistoryPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { HelpPage } from './pages/HelpPage.js'
import { UpdateCheck } from './native/UpdateCheck.js'
import { registerNavHandler } from './native/navTo.js'

export function App() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  // Let native code (notification taps) drive navigation.
  useEffect(() => registerNavHandler((path) => navigate(path)), [navigate])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!user) {
    return <SignInPage />
  }

  return (
    <AppLayout>
      <UpdateCheck />
      <Routes>
        <Route path="/" element={<RemindersPage />} />
        <Route path="/reminders/new" element={<ReminderEditorPage />} />
        <Route path="/reminders/:id" element={<ReminderEditorPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  )
}
