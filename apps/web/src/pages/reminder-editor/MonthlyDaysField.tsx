/**
 * The monthly day-of-month picker: a wrapping grid of 1-31 toggles plus a
 * separate "last day of the month" switch.
 *
 * The last day is its own control rather than a 32nd number because it is not a
 * fixed date — it resolves to 28/29/30/31 per month. That also gives the honest
 * answer to "the 31st in February": a numbered day the month doesn't have is
 * skipped, never clamped, so anyone who means "end of the month" is pointed here.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
import Checkbox from '@mui/joy/Checkbox'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import FormHelperText from '@mui/joy/FormHelperText'

const DAYS = Array.from({ length: 31 }, (_v, i) => i + 1)

/** Days that don't exist in every month — worth calling out before they surprise. */
const SHORT_MONTH_DAYS = [29, 30, 31]

export function MonthlyDaysField({
  daysOfMonth,
  lastDayOfMonth,
  onChangeDays,
  onChangeLastDay
}: {
  daysOfMonth: number[]
  lastDayOfMonth: boolean
  onChangeDays: (days: number[]) => void
  onChangeLastDay: (lastDay: boolean) => void
}) {
  const toggle = (day: number) =>
    onChangeDays(
      daysOfMonth.includes(day) ? daysOfMonth.filter((d) => d !== day) : [...daysOfMonth, day].sort((a, b) => a - b)
    )
  const picksShortMonthDay = daysOfMonth.some((day) => SHORT_MONTH_DAYS.includes(day))

  return (
    <FormControl>
      <FormLabel>Days of month</FormLabel>
      {/* A grid rather than a wrapping row: 31 equal cells stay tappable and line
          up as a calendar-ish block at phone widths. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(2.5rem, 1fr))',
          gap: 0.5
        }}
      >
        {DAYS.map((day) => (
          <Button
            key={day}
            size="sm"
            variant={daysOfMonth.includes(day) ? 'solid' : 'outlined'}
            onClick={() => toggle(day)}
            sx={{ minWidth: 0, px: 0 }}
          >
            {day}
          </Button>
        ))}
      </Box>
      <Stack sx={{ mt: 1 }}>
        <Checkbox
          label="Last day of the month"
          checked={lastDayOfMonth}
          onChange={(e) => onChangeLastDay(e.target.checked)}
        />
      </Stack>
      {picksShortMonthDay && (
        <FormHelperText>
          A month without that day is skipped — February has no 30th or 31st. Use "Last day of the month" for the end
          of every month.
        </FormHelperText>
      )}
    </FormControl>
  )
}
