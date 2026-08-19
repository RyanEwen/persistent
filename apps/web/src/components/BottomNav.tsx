/**
 * Fixed bottom tab bar: switch between what's due now (Current), what's scheduled
 * (Upcoming), the notes kept to be read, history (past/done), and settings.
 * Mobile-first primary navigation.
 *
 * Order is chronological on purpose — now, next, past — so Upcoming sits between
 * Current and History, and Notes sits after them: it is the one tab with no place in
 * that sequence, since a note never happens. Keep `TAB_ROUTES` in
 * `native/useNativeBack.ts` in step: Android Back treats a tab root as a place it
 * falls back *to*, and a route missing from that list is treated as a child screen
 * instead.
 *
 * **Notes is conditional** — it appears only while the user has at least one note.
 * Five tabs is already the most a phone bar carries comfortably, and a note is opt-in:
 * most accounts have none, and a permanently empty tab would spend a fifth of the bar
 * advertising a feature rather than navigating to anything. The `/notes` route exists
 * regardless (see `pages/NotesPage.tsx`); this only decides whether to offer the way in.
 */
import { useEffect, useState } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import type { SvgIconComponent } from '@mui/icons-material'
import Sheet from '@mui/joy/Sheet'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import Typography from '@mui/joy/Typography'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import ScheduleIcon from '@mui/icons-material/Schedule'
import StickyNote2Icon from '@mui/icons-material/StickyNote2'
import HistoryIcon from '@mui/icons-material/History'
import SettingsIcon from '@mui/icons-material/Settings'
import { useReminders } from '../data/reminders.js'
import { isNote } from '../lib/notes.js'

interface NavItem {
  to: string
  label: string
  icon: SvgIconComponent
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Current', icon: NotificationsActiveIcon },
  { to: '/upcoming', label: 'Upcoming', icon: ScheduleIcon },
  { to: '/notes', label: 'Notes', icon: StickyNote2Icon },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon }
]

/** An on-screen keyboard can only be up if something typeable has focus. */
function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * True while the on-screen keyboard is up. The bar hides then, so the keyboard
 * doesn't push it up over the content.
 *
 * Height is compared against a running maximum rather than a fixed number, since
 * there is no portable way to ask how tall the viewport "should" be. That baseline
 * only ever grew, which is correct on a phone (the viewport has one full height)
 * and wrong everywhere else: **the Windows flyout can be dragged to resize**, and
 * its WebView is suspended and resumed rather than reloaded. Shrink the window by
 * more than the threshold, or catch one odd measurement while it is being sized,
 * and the bar was hidden for the life of the page with no keyboard anywhere near
 * it. That is the "no tab bar at the bottom" state, and it stuck because nothing
 * ever lowered the baseline.
 *
 * The focus check is what bounds it: with nothing typeable focused there is no
 * keyboard, so treat the current height as the new truth instead of evidence of
 * one. It stays a *guard* on the viewport measurement rather than replacing it,
 * because the original reason for measuring still holds — the keyboard can close
 * while the input keeps focus, and the bar has to come back for that too.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    let baseline = vv?.height ?? window.innerHeight
    const measure = () => {
      const h = vv?.height ?? window.innerHeight
      if (!isEditableFocused()) {
        // Re-baseline: this height is the window's real size, not a keyboard.
        baseline = h
        setOpen(false)
        return
      }
      baseline = Math.max(baseline, h)
      setOpen(baseline - h > 150)
    }
    measure()
    vv?.addEventListener('resize', measure)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    // Focus changes decide which branch above applies, so they have to re-measure
    // too — otherwise blurring an input leaves the bar hidden until the next resize.
    document.addEventListener('focusin', measure)
    document.addEventListener('focusout', measure)
    return () => {
      vv?.removeEventListener('resize', measure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      document.removeEventListener('focusin', measure)
      document.removeEventListener('focusout', measure)
    }
  }, [])
  return open
}

export function BottomNav() {
  const { pathname } = useLocation()
  const reminders = useReminders()
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  // Hide the bar while typing so the keyboard doesn't push it up over the content.
  const keyboardOpen = useKeyboardOpen()
  if (keyboardOpen) return null

  // The Notes tab earns its place only when there is a note to show — but never
  // disappears from under the user while they are standing on it, which is what
  // deleting their last note would otherwise do.
  const hasNotes = (reminders.data ?? []).some(isNote)
  const items = ITEMS.filter((item) => item.to !== '/notes' || hasNotes || isActive('/notes'))

  return (
    <Sheet
      variant="solid"
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        bgcolor: 'background.surface',
        borderTop: '1px solid',
        borderColor: 'divider',
        // Extend the bar's background down behind the gesture bar while keeping the
        // buttons above it — otherwise the tabs sit under the system navigation.
        pb: 'env(safe-area-inset-bottom, 0px)',
        pl: 'env(safe-area-inset-left, 0px)',
        pr: 'env(safe-area-inset-right, 0px)'
      }}
    >
      <Stack direction="row" sx={{ maxWidth: 640, mx: 'auto' }}>
        {items.map(({ to, label, icon: Icon }) => {
          const active = isActive(to)
          return (
            <Button
              key={to}
              component={RouterLink}
              to={to}
              variant={active ? 'soft' : 'plain'}
              color={active ? 'primary' : 'neutral'}
              // `minWidth: 0` + a small inline padding is what lets five tabs share a
              // 320px phone: a Button won't shrink below its own content otherwise, so the
              // row would overflow the centred column instead of dividing it.
              sx={{ flex: 1, minWidth: 0, flexDirection: 'column', gap: 0.25, py: 1, px: 0.5, borderRadius: 0 }}
            >
              <Icon fontSize="small" />
              <Typography level="body-xs" noWrap sx={{ color: 'inherit', maxWidth: '100%' }}>
                {label}
              </Typography>
            </Button>
          )
        })}
      </Stack>
    </Sheet>
  )
}
