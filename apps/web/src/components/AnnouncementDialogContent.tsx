/** Present unread account announcements after startup and existing dialogs finish. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, DialogContent, DialogTitle, ModalDialog, Stack, Typography } from '@mui/joy'
import type { Announcement } from '@persistent/shared'
import { BackAwareModal } from './BackAwareModal.js'
import { hasPendingBackAwareDialog, subscribeBackAwareDialogs } from './backAwareDialogStack.js'
import { useStartupDataReady } from './startupDataContext.js'

interface AnnouncementDialogContentProps {
  announcements: Announcement[] | undefined
  loaded: boolean
  enabled: boolean
  onViewed: (input: { id: string }) => void
}

export function AnnouncementDialogContent({ announcements, loaded, enabled, onViewed }: AnnouncementDialogContentProps) {
  const ready = useStartupDataReady()
  const { pathname } = useLocation()
  const dialogOpen = useSyncExternalStore(subscribeBackAwareDialogs, hasPendingBackAwareDialog, () => false)
  const [active, setActive] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    // A reminder deep link or editor has priority over product news. Keep an
    // already-open announcement mounted through background refreshes.
    if (active || !ready || !enabled || dialogOpen) return
    // A sibling can register in this commit before our captured snapshot rerenders.
    if (hasPendingBackAwareDialog()) return
    if (pathname.startsWith('/reminders/') || pathname.startsWith('/shared/')) return
    const next = announcements?.find((announcement) => !dismissed.has(announcement.id))
    if (next) setActive(next)
  }, [active, ready, enabled, dialogOpen, announcements, dismissed, pathname])

  // A dismissal on another device closes this account's matching dialog too.
  useEffect(() => {
    if (active && loaded && !announcements?.some((item) => item.id === active.id)) {
      setActive(null)
    }
  }, [active, loaded, announcements])

  const close = () => {
    if (!active) return
    const id = active.id
    setDismissed((previous) => new Set([...previous, id]))
    setActive(null)
    onViewed({ id })
  }

  return (
    <BackAwareModal open={Boolean(active)} onClose={close}>
      <ModalDialog sx={{ width: 'min(480px, calc(100vw - 32px))' }}>
        <DialogTitle>{active?.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            {active?.paragraphs.map((paragraph) => <Typography key={paragraph}>{paragraph}</Typography>)}
          </Stack>
        </DialogContent>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button variant="plain" color="neutral" onClick={close}>Got it</Button>
        </Stack>
      </ModalDialog>
    </BackAwareModal>
  )
}
