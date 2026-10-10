/**
 * Top-level routing. Unauthenticated users see the sign-in screen; everyone else
 * gets the app shell (reminders list, editor, settings).
 */
import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import { AppLoading } from './components/AppLoading.js'
import { StartupDataGate } from './components/StartupDataGate.js'
import { AnnouncementDialog } from './components/AnnouncementDialog.js'
import { useAuth } from './auth/useAuth.js'
import { AppLayout } from './components/AppLayout.js'
import { ReminderDialogProvider } from './components/ReminderDialogs.js'
import { SignInPage } from './pages/SignInPage.js'
import { RemindersPage } from './pages/RemindersPage.js'
import { UpcomingPage } from './pages/UpcomingPage.js'
import { NotesPage } from './pages/NotesPage.js'
import { ReminderDialogLink } from './components/ReminderDialogLink.js'
import { SharedReminderPage } from './pages/SharedReminderPage.js'
import { AssignmentsPage } from './pages/AssignmentsPage.js'
import { HistoryPage } from './pages/HistoryPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { PromotedAppsPage } from './pages/PromotedAppsPage.js'
import { AdminPage } from './pages/admin/AdminPage.js'
import { ReceivedSharesPage } from './pages/ReceivedSharesPage.js'
import { HelpPage } from './pages/HelpPage.js'
import { PrivacyPage } from './pages/PrivacyPage.js'
import { DeleteAccountPage } from './pages/DeleteAccountPage.js'
import { DirectBuildMigrationNotice } from './native/DirectBuildMigrationNotice.js'
import { DesktopWidgetSync } from './native/DesktopWidgetSync.js'
import { clearWidgetSnapshot } from './native/desktopBridge.js'
import { registerNavHandler } from './native/navTo.js'
import { useNativeBack } from './native/useNativeBack.js'
import { useScrollReset } from './lib/useScrollReset.js'

export function App() {
  const { user, loading, error, refreshSession } = useAuth()
  const navigate = useNavigate()

  // Let native code (notification taps) drive navigation.
  useEffect(() => registerNavHandler((path) => navigate(path)), [navigate])
  // Android Back follows the screen hierarchy instead of browser history.
  useNativeBack()
  // A new screen starts at the top; Back keeps where you were.
  useScrollReset()

  useEffect(() => {
    if (!loading && !user) clearWidgetSnapshot()
  }, [loading, user])

  if (loading) return <AppLoading />
  if (error) {
    return (
      <Stack spacing={2} sx={{ p: 3 }}>
        <Typography>Could not check your session.</Typography>
        <Button variant="soft" onClick={() => { void refreshSession().catch(() => {}) }}>Retry</Button>
      </Stack>
    )
  }

  // Google Play fetches the listing's privacy-policy and account-deletion URLs
  // without a session, so both must resolve signed out — hence routing them ahead
  // of the gate as well as inside the app shell below.
  if (!user) {
    return (
      <Routes>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        <Route path="*" element={<SignInPage />} />
      </Routes>
    )
  }

  return (
    <StartupDataGate key={user.id}>
      <AppLayout>
        <ReminderDialogProvider>
        <DirectBuildMigrationNotice />
        <DesktopWidgetSync />
        <AnnouncementDialog />
        <Routes>
          <Route path="/" element={<RemindersPage />} />
          <Route path="/upcoming" element={<UpcomingPage />} />
          {/* Routed unconditionally even though its tab is hidden without notes: a saved
              note lands here, and a link to it must not fall through to Current. */}
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/reminders/new" element={<ReminderDialogLink kind="new" />} />
          <Route path="/reminders/:id" element={<ReminderDialogLink kind="view" />} />
          <Route path="/shared/:id" element={<SharedReminderPage />} />
          <Route path="/assigned" element={<AssignmentsPage />} />
          <Route path="/reminders/:id/edit" element={<ReminderDialogLink kind="edit" />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/apps" element={<PromotedAppsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/settings/shared" element={<ReceivedSharesPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/delete-account" element={<DeleteAccountPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ReminderDialogProvider>
      </AppLayout>
    </StartupDataGate>
  )
}
