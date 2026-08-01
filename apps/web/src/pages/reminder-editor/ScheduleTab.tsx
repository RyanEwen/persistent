/**
 * Schedule tab: the When toggle (no date/time vs a real schedule), the repeat
 * kind, and whichever fields that kind needs — times of day, weekdays, days of
 * the month, the N-day interval, and the date range.
 */
import Stack from '@mui/joy/Stack'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import FormHelperText from '@mui/joy/FormHelperText'
import Input from '@mui/joy/Input'
import Button from '@mui/joy/Button'
import Checkbox from '@mui/joy/Checkbox'
import IconButton from '@mui/joy/IconButton'
import { scheduleKinds, type ScheduleKind } from '@persistent/shared'
import { MonthlyDaysField } from './MonthlyDaysField.js'
import type { FormState } from './formState.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Repeat options offered once the user has chosen to schedule — 'none' is the
 *  absence of a schedule, so it belongs to the When toggle above, not here. */
const REPEAT_KINDS = scheduleKinds.filter((k) => k !== 'none')

const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  // 'none' is chosen via the When toggle, not the Repeat row (see REPEAT_KINDS).
  none: 'No date or time',
  once: 'No repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  interval: 'Every N days',
  custom: 'Custom days'
}

export function ScheduleTab({
  form,
  set,
  onKindChange,
  isEditing
}: {
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  onKindChange: (kind: ScheduleKind) => void
  isEditing: boolean
}) {
  const isOnce = form.kind === 'once'
  const needsDays = form.kind === 'weekly' || form.kind === 'custom'
  const needsMonthDays = form.kind === 'monthly'
  const needsInterval = form.kind === 'interval'
  const canSkipWeekends = form.kind === 'daily' || form.kind === 'interval'

  return (
    <Stack spacing={2}>
      {/* Shown when editing too: "no date/time" is a saved state, so an
          unscheduled reminder has to be able to show it and to gain a schedule. */}
      <FormControl>
        <FormLabel>When</FormLabel>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="sm" variant={form.scheduled ? 'outlined' : 'solid'} onClick={() => set('scheduled', false)}>
            {isEditing ? 'No date or time' : 'Remind me now'}
          </Button>
          <Button size="sm" variant={form.scheduled ? 'solid' : 'outlined'} onClick={() => set('scheduled', true)}>
            Schedule it
          </Button>
        </Stack>
        <FormHelperText>
          {form.scheduled
            ? 'Pick when it fires and whether it repeats.'
            : isEditing
              ? 'Has no date or time. It fired once, when you created it.'
              : 'Fires as soon as you create it — nothing to pick.'}
        </FormHelperText>
      </FormControl>

      {form.scheduled && (
        <>
          <FormControl>
            <FormLabel>Repeat</FormLabel>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {REPEAT_KINDS.map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={form.kind === k ? 'solid' : 'outlined'}
                  onClick={() => onKindChange(k)}
                >
                  {SCHEDULE_KIND_LABELS[k]}
                </Button>
              ))}
            </Stack>
          </FormControl>

          {isOnce ? (
            <FormControl>
              <FormLabel>Time</FormLabel>
              <Input
                type="time"
                value={form.timesOfDay[0] ?? '08:00'}
                onChange={(e) => set('timesOfDay', [e.target.value])}
              />
            </FormControl>
          ) : (
            <FormControl>
              <FormLabel>Times of day</FormLabel>
              <Stack spacing={1}>
                {form.timesOfDay.map((time, index) => (
                  <Stack key={index} direction="row" spacing={1} alignItems="center">
                    <Input
                      type="time"
                      value={time}
                      onChange={(e) =>
                        set(
                          'timesOfDay',
                          form.timesOfDay.map((t, i) => (i === index ? e.target.value : t))
                        )
                      }
                      sx={{ flex: 1 }}
                    />
                    {form.timesOfDay.length > 1 && (
                      <IconButton
                        variant="outlined"
                        color="danger"
                        onClick={() =>
                          set(
                            'timesOfDay',
                            form.timesOfDay.filter((_t, i) => i !== index)
                          )
                        }
                      >
                        ✕
                      </IconButton>
                    )}
                  </Stack>
                ))}
                <Button variant="outlined" size="sm" onClick={() => set('timesOfDay', [...form.timesOfDay, '12:00'])}>
                  Add time
                </Button>
              </Stack>
            </FormControl>
          )}

          {needsDays && (
            <FormControl>
              <FormLabel>Days of week</FormLabel>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {DAY_NAMES.map((name, day) => (
                  <Checkbox
                    key={day}
                    label={name}
                    checked={form.daysOfWeek.includes(day)}
                    onChange={(e) =>
                      set(
                        'daysOfWeek',
                        e.target.checked
                          ? [...form.daysOfWeek, day].sort((a, b) => a - b)
                          : form.daysOfWeek.filter((d) => d !== day)
                      )
                    }
                  />
                ))}
              </Stack>
            </FormControl>
          )}

          {needsMonthDays && (
            <MonthlyDaysField
              daysOfMonth={form.daysOfMonth}
              lastDayOfMonth={form.lastDayOfMonth}
              onChangeDays={(days) => set('daysOfMonth', days)}
              onChangeLastDay={(lastDay) => set('lastDayOfMonth', lastDay)}
            />
          )}

          {needsInterval && (
            <FormControl>
              <FormLabel>Every N days</FormLabel>
              <Input
                type="number"
                value={form.everyNDays}
                onChange={(e) => set('everyNDays', e.target.value)}
                slotProps={{ input: { min: 1, max: 365 } }}
              />
            </FormControl>
          )}

          {canSkipWeekends && (
            <Checkbox
              label="Skip weekends"
              checked={form.skipWeekends}
              onChange={(e) => set('skipWeekends', e.target.checked)}
            />
          )}

          {isOnce ? (
            <FormControl>
              <FormLabel>Date</FormLabel>
              <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </FormControl>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <FormControl sx={{ flex: 1, minWidth: 0 }}>
                <FormLabel>Start date</FormLabel>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                  sx={{ minWidth: 0 }}
                />
              </FormControl>
              <FormControl sx={{ flex: 1, minWidth: 0 }}>
                <FormLabel>End date (optional)</FormLabel>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set('endDate', e.target.value)}
                  sx={{ minWidth: 0 }}
                />
              </FormControl>
            </Stack>
          )}
        </>
      )}
    </Stack>
  )
}
