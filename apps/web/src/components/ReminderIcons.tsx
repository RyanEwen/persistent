/**
 * Icons for a reminder's type and an occurrence's status (doneness / snoozed /
 * escalated). Centralized so the mapping stays consistent wherever
 * reminders/occurrences are listed.
 */
import Chip from '@mui/joy/Chip'
import type { ColorPaletteProp } from '@mui/joy/styles'
import type { SvgIconComponent } from '@mui/icons-material'
import MedicationIcon from '@mui/icons-material/Medication'
import ChecklistIcon from '@mui/icons-material/Checklist'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import SnoozeIcon from '@mui/icons-material/Snooze'
import CampaignIcon from '@mui/icons-material/Campaign'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import type { OccurrenceStatus, ReminderType } from '@persistent/shared'
import { reminderTypeLabel } from '../lib/format.js'

type IconSize = 'small' | 'medium' | 'large' | 'inherit'

const TYPE_ICON: Record<ReminderType, SvgIconComponent> = {
  NONE: NotificationsNoneIcon,
  TODO: ChecklistIcon,
  MEDICATION: MedicationIcon
}

export function TypeIcon({
  type,
  fontSize = 'small',
  size
}: {
  type: ReminderType
  fontSize?: IconSize
  /** Explicit pixel size; overrides fontSize when set. */
  size?: number
}) {
  const Icon = TYPE_ICON[type]
  // aria-label (not titleAccess) so no <title> text leaks into e.g. Select values.
  return (
    <Icon fontSize={fontSize} sx={size ? { fontSize: size } : undefined} role="img" aria-label={reminderTypeLabel(type)} />
  )
}

const STATUS_ICON: Record<OccurrenceStatus, SvgIconComponent> = {
  PENDING: NotificationsActiveIcon,
  FIRED: NotificationsActiveIcon,
  ACKNOWLEDGED: CheckCircleIcon,
  SNOOZED: SnoozeIcon,
  ESCALATED: CampaignIcon,
  MISSED: ErrorOutlineIcon,
  SUPERSEDED: SkipNextIcon
}

const STATUS_TITLE: Record<OccurrenceStatus, string> = {
  PENDING: 'Scheduled',
  FIRED: 'Due',
  ACKNOWLEDGED: 'Done',
  SNOOZED: 'Snoozed',
  ESCALATED: 'Escalated',
  MISSED: 'Missed',
  SUPERSEDED: 'Superseded'
}

export function StatusIcon({ status, fontSize = 'small' }: { status: OccurrenceStatus; fontSize?: IconSize }) {
  const Icon = STATUS_ICON[status]
  return <Icon fontSize={fontSize} role="img" aria-label={STATUS_TITLE[status]} />
}

const STATUS_COLOR: Record<OccurrenceStatus, ColorPaletteProp> = {
  PENDING: 'neutral',
  FIRED: 'warning',
  ACKNOWLEDGED: 'success',
  SNOOZED: 'primary',
  ESCALATED: 'danger',
  MISSED: 'danger',
  SUPERSEDED: 'neutral'
}

/** A colored, labeled status chip (e.g. green "Done", red "Missed") for list rows. */
export function StatusChip({ status }: { status: OccurrenceStatus }) {
  const Icon = STATUS_ICON[status]
  return (
    <Chip
      size="sm"
      variant="soft"
      color={STATUS_COLOR[status]}
      startDecorator={<Icon sx={{ fontSize: 16 }} />}
    >
      {STATUS_TITLE[status]}
    </Chip>
  )
}
