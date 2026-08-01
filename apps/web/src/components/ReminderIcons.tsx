/**
 * Icons for a reminder's type and an occurrence's status (doneness / snoozed /
 * escalated). Centralized so the mapping stays consistent wherever
 * reminders/occurrences are listed.
 *
 * Every lookup goes through `lookup`, which tolerates a key this build doesn't
 * know. The maps stay exhaustive over the current enums — adding a type still
 * forces an icon — but a value from outside them (a restored cache written by an
 * older release, a server enum the client hasn't shipped yet) must degrade to a
 * generic icon rather than resolve to `undefined`: React rejects an undefined
 * element type outright, so one unknown value would take down the whole view
 * rather than one row of it.
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

/** Map lookup that survives a key from outside the enum (see the file header). */
function lookup<T>(map: Record<string, T>, key: string, fallback: T): T {
  return map[key] ?? fallback
}

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
  const Icon = lookup(TYPE_ICON, type, NotificationsNoneIcon)
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
  const Icon = lookup(STATUS_ICON, status, NotificationsActiveIcon)
  return <Icon fontSize={fontSize} role="img" aria-label={lookup(STATUS_TITLE, status, status)} />
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
  const Icon = lookup(STATUS_ICON, status, NotificationsActiveIcon)
  return (
    <Chip
      size="sm"
      variant="soft"
      color={lookup(STATUS_COLOR, status, 'neutral')}
      startDecorator={<Icon sx={{ fontSize: 16 }} />}
    >
      {lookup(STATUS_TITLE, status, status)}
    </Chip>
  )
}
