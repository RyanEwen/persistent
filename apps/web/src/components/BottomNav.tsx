/**
 * Fixed bottom tab bar: switch between the current view, history (past/done),
 * and settings. Mobile-first primary navigation.
 */
import { useEffect, useState } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import type { SvgIconComponent } from '@mui/icons-material'
import Sheet from '@mui/joy/Sheet'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import Typography from '@mui/joy/Typography'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import HistoryIcon from '@mui/icons-material/History'
import SettingsIcon from '@mui/icons-material/Settings'

interface NavItem {
  to: string
  label: string
  icon: SvgIconComponent
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Current', icon: NotificationsActiveIcon },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon }
]

/** True while a text field is focused (i.e. the on-screen keyboard is likely up). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const isTextField = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return tag === 'TEXTAREA' || (tag === 'INPUT' && el.getAttribute('type') !== 'checkbox') || el.isContentEditable
    }
    const onFocusIn = (e: FocusEvent) => isTextField(e.target) && setOpen(true)
    const onFocusOut = () => setOpen(false)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return open
}

export function BottomNav() {
  const { pathname } = useLocation()
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  // Hide the bar while typing so the keyboard doesn't push it up over the content.
  if (useKeyboardOpen()) return null

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
        borderColor: 'divider'
      }}
    >
      <Stack direction="row" sx={{ maxWidth: 640, mx: 'auto' }}>
        {ITEMS.map(({ to, label, icon: Icon }) => {
          const active = isActive(to)
          return (
            <Button
              key={to}
              component={RouterLink}
              to={to}
              variant={active ? 'soft' : 'plain'}
              color={active ? 'primary' : 'neutral'}
              sx={{ flex: 1, flexDirection: 'column', gap: 0.25, py: 1, borderRadius: 0 }}
            >
              <Icon fontSize="small" />
              <Typography level="body-xs" sx={{ color: 'inherit' }}>
                {label}
              </Typography>
            </Button>
          )
        })}
      </Stack>
    </Sheet>
  )
}
