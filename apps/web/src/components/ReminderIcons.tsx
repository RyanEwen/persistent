/**
 * Icons for a reminder's category (type) and an occurrence's status
 * (doneness / snoozed / escalated). Centralized so the mapping stays consistent
 * wherever reminders/occurrences are listed.
 */
import type { SvgIconComponent } from '@mui/icons-material'
import MedicationIcon from '@mui/icons-material/Medication'
import EventIcon from '@mui/icons-material/Event'
import TaskAltIcon from '@mui/icons-material/TaskAlt'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import SnoozeIcon from '@mui/icons-material/Snooze'
import CampaignIcon from '@mui/icons-material/Campaign'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import type { OccurrenceStatus, ReminderCategory } from '@persistent/shared'

type IconSize = 'small' | 'medium' | 'large' | 'inherit'

const CATEGORY_ICON: Record<ReminderCategory, SvgIconComponent> = {
  NONE: NotificationsNoneIcon,
  TASK: TaskAltIcon,
  MEDICATION: MedicationIcon,
  APPOINTMENT: EventIcon
}

const CATEGORY_TITLE: Record<ReminderCategory, string> = {
  NONE: 'Reminder',
  TASK: 'Task',
  MEDICATION: 'Medication',
  APPOINTMENT: 'Appointment'
}

export function CategoryIcon({ category, fontSize = 'small' }: { category: ReminderCategory; fontSize?: IconSize }) {
  const Icon = CATEGORY_ICON[category]
  // aria-label (not titleAccess) so no <title> text leaks into e.g. Select values.
  return <Icon fontSize={fontSize} role="img" aria-label={CATEGORY_TITLE[category]} />
}

const STATUS_ICON: Record<OccurrenceStatus, SvgIconComponent> = {
  PENDING: NotificationsActiveIcon,
  FIRED: NotificationsActiveIcon,
  ACKNOWLEDGED: CheckCircleIcon,
  SNOOZED: SnoozeIcon,
  ESCALATED: CampaignIcon,
  MISSED: ErrorOutlineIcon
}

const STATUS_TITLE: Record<OccurrenceStatus, string> = {
  PENDING: 'Scheduled',
  FIRED: 'Due',
  ACKNOWLEDGED: 'Done',
  SNOOZED: 'Snoozed',
  ESCALATED: 'Escalated',
  MISSED: 'Missed'
}

export function StatusIcon({ status, fontSize = 'small' }: { status: OccurrenceStatus; fontSize?: IconSize }) {
  const Icon = STATUS_ICON[status]
  return <Icon fontSize={fontSize} role="img" aria-label={STATUS_TITLE[status]} />
}
