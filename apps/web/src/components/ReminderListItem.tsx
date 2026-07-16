/**
 * One row in a reminder list — used by both the current list and History so they
 * render identically. A tappable card linking to the reminder's detail view,
 * showing the category icon, title + status, and a "when" line (with an optional
 * secondary recurrence line). Kept compact (small card padding, single-line
 * description) so many reminders fit on a phone screen.
 */
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/joy/Card'
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import type { OccurrenceStatus, ReminderCategory } from '@persistent/shared'
import { CategoryIcon, StatusChip } from './ReminderIcons.js'

export function ReminderListItem({
  to,
  category,
  title,
  status,
  description,
  subtitle,
  secondary,
  trailing
}: {
  to: string
  category: ReminderCategory
  title: string
  status?: OccurrenceStatus | null
  description?: string
  subtitle?: string
  secondary?: string
  trailing?: ReactNode
}) {
  return (
    <Card component={RouterLink} to={to} variant="outlined" size="sm" sx={{ textDecoration: 'none' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          <CategoryIcon category={category} size={24} />
          <Box sx={{ minWidth: 0 }}>
            <Typography level="title-sm" noWrap>
              {title}
            </Typography>
            {description && (
              <Typography level="body-sm" noWrap>
                {description}
              </Typography>
            )}
            {subtitle && <Typography level="body-xs">{subtitle}</Typography>}
            {secondary && (
              <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                {secondary}
              </Typography>
            )}
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
          {status && <StatusChip status={status} />}
          {trailing}
        </Stack>
      </Stack>
    </Card>
  )
}
