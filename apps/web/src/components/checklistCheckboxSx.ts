/** Keep unchecked checklist outlines as legible as the read-only card previews. */
import { checkboxClasses } from '@mui/joy/Checkbox'

export const checklistCheckboxSx = {
  // Upcoming has no firing to tick. Preserve disabled behavior while keeping its
  // empty boxes visible; checked boxes retain Joy's checked-state colors.
  [`& .${checkboxClasses.checkbox}:not(.${checkboxClasses.checked})`]: {
    borderWidth: '1.5px',
    borderColor: 'text.tertiary',
    bgcolor: 'transparent'
  }
}
