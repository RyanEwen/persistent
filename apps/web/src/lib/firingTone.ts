/**
 * How loudly a firing should present itself, and what to call its confirm action.
 *
 * Lives beside `occurrenceSchedule.ts` (which decides *whether* a firing is
 * honestly "Due") rather than in the chip component, so the list and the detail
 * view share one answer and neither drifts.
 */
import type { ColorPaletteProp, VariantProp } from '@mui/joy/styles'
import type { Occurrence, Reminder } from '@persistent/shared'
import { isOutsideReminderWindow, isUnscheduledFiring } from './occurrenceSchedule.js'

export interface FiringTone {
  /** A firing the reminder's current schedule no longer covers. */
  orphaned: boolean
  /** Card color + variant: how loudly this firing should present itself. */
  color: ColorPaletteProp
  variant: VariantProp
  /** Label for the confirm action — "Clear" when there's nothing to have done. */
  doneLabel: 'Done' | 'Clear'
}

/**
 * How loudly a firing should present itself.
 *
 * Only an escalation is genuinely urgent, so only it gets a filled card. An
 * ordinary due reminder is outlined instead of a solid block of amber — it still
 * reads as needing attention without shouting, which matters when the whole point
 * of the app is that these stay on screen until confirmed. Firings with no
 * deadline behind them are quieter still.
 */
export function firingTone(reminder: Reminder, occurrence: Occurrence): FiringTone {
  const orphaned = isOutsideReminderWindow(reminder, occurrence)
  if (occurrence.status === 'ESCALATED') {
    return { orphaned, color: 'danger', variant: 'soft', doneLabel: orphaned ? 'Clear' : 'Done' }
  }
  if (orphaned) return { orphaned, color: 'neutral', variant: 'outlined', doneLabel: 'Clear' }
  if (isUnscheduledFiring(reminder)) {
    return { orphaned, color: 'neutral', variant: 'outlined', doneLabel: 'Done' }
  }
  return { orphaned, color: 'warning', variant: 'outlined', doneLabel: 'Done' }
}
