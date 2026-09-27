/** In-app reminder reading and editing dialogs, independent of page routes. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import ModalDialog from '@mui/joy/ModalDialog'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import ShareIcon from '@mui/icons-material/Share'
import EditIcon from '@mui/icons-material/Edit'
import { BackAwareModal } from './BackAwareModal.js'
import { ReminderSharing } from './ReminderSharing.js'
import { useReminders } from '../data/reminders.js'
import { useReceivedShares } from '../data/shares.js'
import { ReminderDetailPage } from '../pages/ReminderDetailPage.js'
import { ReminderEditorPage } from '../pages/reminder-editor/ReminderEditorPage.js'
import { ReminderDialogContext, type ReminderDialogActions } from './reminderDialogContext.js'

type DialogState = { kind: 'view' | 'edit'; id: string } | { kind: 'new' } | null

export function ReminderDialogProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [closing, setClosing] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const reminders = useReminders()
  const received = useReceivedShares()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorClose = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  /** Keep the content mounted until its exit animation has finished. */
  const close = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      setDialog(null)
      setClosing(false)
      closeTimer.current = null
    }, 180)
  }

  const show = useCallback((next: DialogState) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setClosing(false)
    setDialog(next)
  }, [])
  const requestClose = () => {
    if (dialog?.kind === 'edit' || dialog?.kind === 'new') editorClose.current?.()
    else close()
  }
  const registerClose = (handler: () => void) => { editorClose.current = handler }
  const actions: ReminderDialogActions = useMemo(() => ({
    view: (id) => show({ kind: 'view', id }),
    edit: (id) => show({ kind: 'edit', id }),
    create: () => show({ kind: 'new' })
  }), [show])
  const viewedId = dialog?.kind === 'view' ? dialog.id : null
  const ownerReminder = reminders.data?.find((reminder) => reminder.id === viewedId)
  const receivedReminder = received.data?.find((reminder) => reminder.id === viewedId)
  const canEdit = Boolean(ownerReminder || receivedReminder?.permission === 'EDIT')

  return (
    <ReminderDialogContext.Provider value={actions}>
      {children}
      <BackAwareModal open={dialog !== null} onClose={requestClose}>
        <ModalDialog
          layout="center"
          sx={{
            width: 'min(620px, calc(100vw - 24px))',
            maxHeight: 'min(92dvh, 900px)',
            overflow: 'hidden',
            p: { xs: 2, sm: 3 },
            animation: closing ? 'reminderDialogExit 180ms ease-in forwards' : 'reminderDialogEnter 220ms ease-out',
            pointerEvents: closing ? 'none' : 'auto',
            // Joy's centered layout owns `transform: translate(-50%, -50%)`.
            // Opacity leaves the dialog at that position throughout the animation.
            '@keyframes reminderDialogEnter': {
              from: { opacity: 0 },
              to: { opacity: 1 }
            },
            '@keyframes reminderDialogExit': {
              from: { opacity: 1 },
              to: { opacity: 0 }
            },
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none'
            }
          }}
        >
          <Box sx={{ minHeight: 0, overflowY: 'auto' }}>
            {dialog?.kind === 'view' && (
              <ReminderDetailPage
                reminderId={dialog.id}
                onClose={close}
                onEdit={() => setDialog({ kind: 'edit', id: dialog.id })}
              />
            )}
            {dialog?.kind === 'edit' && (
              <ReminderEditorPage
                key={dialog.id}
                reminderId={dialog.id}
                onClose={() => setDialog({ kind: 'view', id: dialog.id })}
                onFinished={close}
                registerClose={registerClose}
              />
            )}
            {dialog?.kind === 'new' && (
              <ReminderEditorPage
                key="new"
                onClose={close}
                onFinished={(destination) => {
                  close()
                  navigate(destination)
                }}
                registerClose={registerClose}
              />
            )}
          </Box>
          {dialog?.kind === 'view' && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexShrink: 0, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={0.5}>
                {canEdit && (
                  <Button variant="outlined" size="sm" startDecorator={<EditIcon />} onClick={() => setDialog({ kind: 'edit', id: dialog.id })}>Edit</Button>
                )}
                {ownerReminder && (
                  <Button variant="plain" size="sm" startDecorator={<ShareIcon />} onClick={() => setShareOpen(true)}>Share</Button>
                )}
              </Stack>
              <Button variant="outlined" color="neutral" onClick={close}>Close</Button>
            </Box>
          )}
        </ModalDialog>
      </BackAwareModal>
      <ReminderSharing open={shareOpen} onClose={() => setShareOpen(false)} reminderId={ownerReminder?.id} />
    </ReminderDialogContext.Provider>
  )
}
