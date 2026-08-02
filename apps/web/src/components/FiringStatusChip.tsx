/**
 * The status chip on a firing that needs attention, and the card tone that goes
 * with it. Shared by the reminders list and the reminder detail view so both
 * describe the same firing the same way.
 *
 * "Due" is only honest when the reminder actually had a moment to be due at. Two
 * cases don't, and they want opposite treatments:
 *
 * - **Orphaned** — fired before a reschedule moved the reminder's window past it
 *   (see `occurrenceSchedule.ts`). Reads as "Unconfirmed": the label is carrying
 *   real information, because a firing the current schedule doesn't cover
 *   otherwise looks like a bug, and this is what tells the user it needs clearing.
 * - **Unscheduled** (`none`) — fired on creation because the user asked to be
 *   reminded, not because a deadline arrived. This one gets **no chip at all**.
 *   There is no second state for it to be in: an unscheduled firing is either
 *   nagging (and the card's own Done/Snooze say so) or confirmed and gone. A chip
 *   that is a constant is decoration, and "Unconfirmed" reads as a warning about
 *   a reminder that is behaving exactly as asked.
 *
 * A snoozed or escalated unscheduled firing still gets its real chip — those are
 * genuine states worth showing. Only the FIRED case is the constant.
 */
import Chip from '@mui/joy/Chip'
import HistoryIcon from '@mui/icons-material/History'
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
  if (isUnscheduledFiring(reminder) && occurrence.status === 'FIRED') return null
  return <StatusChip status={occurrence.status} />
}
