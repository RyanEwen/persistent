/**
 * The status chip on a firing that needs attention, and the card tone that goes
 * with it. Shared by the reminders list and the reminder detail view so both
 * describe the same firing the same way.
 *
 * "Due" is only honest when the reminder actually had a moment to be due at. Two
 * cases don't:
 *
 * - **Unscheduled** (`none`) — fired on creation because the user asked to be
 *   reminded, not because a deadline arrived. It still needs confirming.
 * - **Orphaned** — fired before a reschedule moved the reminder's window past it
 *   (see `occurrenceSchedule.ts`); it needs clearing, and says why.
 *
 * Both read as "Unconfirmed", because that is exactly what they are.
 */
import Chip from '@mui/joy/Chip'
import HistoryIcon from '@mui/icons-material/History'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import type { Occurrence, Reminder } from '@persistent/shared'
import { isOutsideReminderWindow, isUnscheduledFiring } from '../lib/occurrenceSchedule.js'
import { StatusChip } from './ReminderIcons.js'

export function FiringStatusChip({ reminder, occurrence }: { reminder: Reminder; occurrence: Occurrence }) {
  if (isOutsideReminderWindow(reminder, occurrence)) {
    return (
      <Chip size="sm" variant="soft" color="neutral" startDecorator={<HistoryIcon sx={{ fontSize: 14 }} />}>
        Unconfirmed
      </Chip>
    )
  }
  // A snoozed/escalated unscheduled firing still has a true status worth showing;
  // only its FIRED state would be mislabelled "Due".
  if (isUnscheduledFiring(reminder) && occurrence.status === 'FIRED') {
    return (
      <Chip size="sm" variant="soft" color="neutral" startDecorator={<NotificationsNoneIcon sx={{ fontSize: 14 }} />}>
        Unconfirmed
      </Chip>
    )
  }
  return <StatusChip status={occurrence.status} />
}
