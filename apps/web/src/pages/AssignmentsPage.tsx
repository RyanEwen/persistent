/** Creator-only status of reminders made for someone else. */
import Button from '@mui/joy/Button'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import Sheet from '@mui/joy/Sheet'
import Chip from '@mui/joy/Chip'
import { Link as RouterLink } from 'react-router-dom'
import { useSentAssignments, useResendAssignmentInvitation } from '../data/assignments.js'
import { formatWhen } from '../lib/datetime.js'
import { useSettings } from '../settings/useSettings.js'
import { useAuth } from '../auth/useAuth.js'
import { SectionHeading } from '../components/SectionHeading.js'
import { PullToRefresh } from '../components/PullToRefresh.js'

/** A firing remains independently visible, including exactly when it was done. */
function firingLabel(firing: { status: string; acknowledgedAt: string | null }): string {
  if (firing.status === 'ACKNOWLEDGED') return 'Done'
  if (firing.status === 'PENDING') return 'Scheduled'
  if (firing.status === 'SNOOZED') return 'Snoozed'
  if (firing.status === 'ESCALATED') return 'Escalated'
  if (firing.status === 'FIRED') return 'Waiting'
  return firing.status === 'MISSED' ? 'Missed' : 'Past'
}

export function AssignmentsPage() {
  const sent = useSentAssignments()
  const resend = useResendAssignmentInvitation()
  const { timeFormat } = useSettings()
  const { user } = useAuth()

  return (
    <PullToRefresh onRefresh={() => sent.refetch()}>
      <Stack spacing={2}>
        <SectionHeading title="Assigned by me" subtitle="See when reminders you made for someone else are handled." />
        {sent.isLoading && <Typography level="body-sm">Loading...</Typography>}
        {sent.data?.length === 0 && (
          <Typography level="body-sm">
            No assignments yet. Open <RouterLink to="/reminders/new">New reminder</RouterLink>, then choose For someone else in Share.
          </Typography>
        )}
        {sent.data?.map((assignment) => (
          <Sheet key={assignment.id} variant="outlined" sx={{ p: 2, borderRadius: 'md' }}>
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                <Typography level="title-md">{assignment.title}</Typography>
                <Chip size="sm" variant="soft" color={assignment.state === 'DECLINED' ? 'danger' : 'neutral'}>
                  {assignment.state === 'PENDING' ? 'Invitation pending' : assignment.state === 'DECLINED' ? 'Declined' : 'Assigned'}
                </Chip>
              </Stack>
              <Typography level="body-sm">For {assignment.recipientEmail}</Typography>
              {assignment.lastCompletedAt && (
                <Typography level="body-sm">
                  Last completed {formatWhen(assignment.lastCompletedAt, timeFormat, user?.timeZone)}
                </Typography>
              )}
              {assignment.declinedAt && (
                <Typography level="body-sm">
                  Declined {formatWhen(assignment.declinedAt, timeFormat, user?.timeZone)}
                </Typography>
              )}
              {assignment.state === 'PENDING' && (
                <Button size="sm" variant="outlined" loading={resend.isPending} onClick={() => resend.mutate(assignment.id)}>
                  Resend invitation
                </Button>
              )}
              {assignment.state === 'ACTIVE' && assignment.recentFirings.length === 0 && (
                <Typography level="body-sm">No firing yet.</Typography>
              )}
              {assignment.state === 'ACTIVE' && assignment.recentFirings.length > 0 && (
                <Stack spacing={0.5}>
                  <Typography level="title-sm">Recent firings</Typography>
                  {assignment.recentFirings.map((firing) => (
                    <Typography key={firing.id} level="body-sm">
                      {formatWhen(firing.scheduledFor, timeFormat, user?.timeZone)}: {firingLabel(firing)}
                      {firing.acknowledgedAt ? ` at ${formatWhen(firing.acknowledgedAt, timeFormat, user?.timeZone)}` : ''}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Stack>
          </Sheet>
        ))}
      </Stack>
    </PullToRefresh>
  )
}
