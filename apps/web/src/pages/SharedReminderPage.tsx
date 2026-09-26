/** Recipient view of a shared reminder, with shared Done and personal Snooze. */
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import Stack from '@mui/joy/Stack'
import Button from '@mui/joy/Button'
import Typography from '@mui/joy/Typography'
import Card from '@mui/joy/Card'
import Checkbox from '@mui/joy/Checkbox'
import ModalDialog from '@mui/joy/ModalDialog'
import DialogTitle from '@mui/joy/DialogTitle'
import DialogActions from '@mui/joy/DialogActions'
import { reminderBodyText, todoItems } from '@persistent/shared'
import { useLeaveSharedReminder, useReceivedShares } from '../data/shares.js'
import { BackAwareModal } from '../components/BackAwareModal.js'
import { SectionHeading } from '../components/SectionHeading.js'
import { SnoozeDialog } from '../components/SnoozeDialog.js'
import { useAckOccurrence, useCheckOccurrenceItem, useSnoozeOccurrence } from '../data/occurrences.js'
import { useCheckReminderItem } from '../data/reminders.js'
import { formatDateTime, formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { useAuth } from '../auth/useAuth.js'

export function SharedReminderPage() {
  const { id } = useParams()
  const received = useReceivedShares()
  const leave = useLeaveSharedReminder()
  const navigate = useNavigate()
  const reminder = received.data?.find((item) => item.id === id)
  const ack = useAckOccurrence()
  const snooze = useSnoozeOccurrence()
  const check = useCheckOccurrenceItem()
  const checkNote = useCheckReminderItem()
  const { timeFormat } = useSettings()
  const { user } = useAuth()
  const [snoozeId, setSnoozeId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)

  return (
    <Stack spacing={2}>
      <Button component={RouterLink} to="/" variant="plain" color="neutral" sx={{ alignSelf: 'flex-start' }}>
        Back
      </Button>
      {received.isLoading ? (
        <Typography level="body-sm">Loading...</Typography>
      ) : !reminder ? (
        <Typography level="body-sm">This reminder is no longer shared with you.</Typography>
      ) : (
        <>
          <SectionHeading title={reminder.title} subtitle={`Shared by ${reminder.ownerName}`} />
          {reminder.nextScheduledFor && (
            <Typography level="body-sm">
              Next notification for you: {formatWhen(reminder.nextScheduledFor, timeFormat, user?.timeZone)} (your time zone)
            </Typography>
          )}
          <Button component={RouterLink} to={`/reminders/${reminder.id}/edit`} variant="outlined" sx={{ alignSelf: 'flex-start' }}>
            Edit reminder
          </Button>
          <Card variant="soft">
            <Typography level="body-sm" sx={{ whiteSpace: 'pre-wrap' }}>
              {reminder.type === 'TODO' ? reminder.details : reminderBodyText(reminder)}
            </Typography>
            {reminder.type === 'TODO' && reminder.activeFirings.length === 0 && (
              <Stack spacing={0.5}>
                {todoItems(reminder.typeData).map((item) => (
                  reminder.isNote ? (
                    <Checkbox
                      key={item.id}
                      label={item.text}
                      checked={reminder.checkedItemIds.includes(item.id)}
                      onChange={(event) => checkNote.mutate({ id: reminder.id, arg: { itemId: item.id, checked: event.target.checked } })}
                    />
                  ) : (
                    <Typography key={item.id} level="body-sm">
                      {reminder.checkedItemIds.includes(item.id) ? '[x]' : '[ ]'} {item.text}
                    </Typography>
                  )
                ))}
              </Stack>
            )}
          </Card>
          {reminder.activeFirings.map((firing) => (
            <Card key={firing.id} variant="outlined">
              <Typography level="title-sm">Needs attention: {formatDateTime(firing.scheduledFor, timeFormat, user?.timeZone)}</Typography>
              {firing.status === 'SNOOZED' && firing.snoozedUntil && (
                <Typography level="body-sm">Snoozed for you until {formatDateTime(firing.snoozedUntil, timeFormat, user?.timeZone)}</Typography>
              )}
              {reminder.type === 'TODO' && (
                <Stack spacing={1}>
                  {todoItems(reminder.typeData).map((item) => (
                    <Checkbox
                      key={item.id}
                      label={item.text}
                      checked={firing.checkedItemIds.includes(item.id)}
                      onChange={(event) => check.mutate({ id: firing.id, arg: { itemId: item.id, checked: event.target.checked } })}
                    />
                  ))}
                </Stack>
              )}
              <Stack direction="row" spacing={1}>
                {confirmId === firing.id ? (
                  <>
                    <Button variant="outlined" color="neutral" onClick={() => setConfirmId(null)}>Not yet</Button>
                    <Button color="success" loading={ack.isPending} onClick={() => ack.mutate({ id: firing.id, arg: undefined })}>
                      Confirm done for everyone
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outlined" onClick={() => setSnoozeId(firing.id)}>Snooze for me</Button>
                    <Button color="success" onClick={() => setConfirmId(firing.id)}>Done for everyone</Button>
                  </>
                )}
              </Stack>
            </Card>
          ))}
          <Button variant="plain" color="danger" sx={{ alignSelf: 'flex-start' }} onClick={() => setLeaveOpen(true)}>
            Leave reminder
          </Button>
          <BackAwareModal open={leaveOpen} onClose={() => setLeaveOpen(false)}>
            <ModalDialog sx={{ width: 'min(400px, calc(100vw - 32px))' }}>
              <DialogTitle>Leave shared reminder?</DialogTitle>
              <Typography level="body-sm">You will lose access. The reminder will stay with its owner.</Typography>
              <DialogActions>
                <Button variant="plain" color="neutral" onClick={() => setLeaveOpen(false)}>Cancel</Button>
                <Button color="danger" loading={leave.isPending} onClick={() => {
                  leave.mutate(reminder.id, { onSuccess: () => navigate('/') })
                }}>Leave reminder</Button>
              </DialogActions>
            </ModalDialog>
          </BackAwareModal>
          <SnoozeDialog
            open={snoozeId !== null}
            busy={snooze.isPending}
            onClose={() => setSnoozeId(null)}
            onSnooze={(minutes) => {
              if (snoozeId) snooze.mutate({ id: snoozeId, arg: minutes })
              setSnoozeId(null)
            }}
          />
        </>
      )}
    </Stack>
  )
}
