/**
 * Escalation tab: escalate an ignored reminder to an alarm on the user's own
 * devices, and/or email a nominated contact. Both are unavailable when the
 * reminder is already an ALARM — it rings continuously, so there is nothing to
 * escalate to.
 */
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Input from '@mui/joy/Input'
import Textarea from '@mui/joy/Textarea'
import Button from '@mui/joy/Button'
import Checkbox from '@mui/joy/Checkbox'
import Alert from '@mui/joy/Alert'
import Divider from '@mui/joy/Divider'
import { DurationField } from '../../components/DurationField.js'
import type { FormState } from './formState.js'

export function EscalationTab({
  form,
  set
}: {
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}) {
  if (form.persistence === 'ALARM') {
    return (
      <Alert color="neutral" variant="soft">
        This reminder already rings an alarm continuously until done, so escalation doesn't apply. Switch the
        notification type to a Notification (Notifications tab) to use escalation.
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      <Checkbox
        label="Escalate to an alarm if ignored"
        checked={form.escalate}
        onChange={(e) => set('escalate', e.target.checked)}
      />
      {form.escalate && (
        <Stack spacing={2}>
          <Typography level="body-xs">
            If still not done, it rings an alarm (sound until done) on your devices.
          </Typography>
          <FormControl>
            <FormLabel>Escalate</FormLabel>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="sm"
                variant={form.escalateMode === 'after' ? 'solid' : 'outlined'}
                onClick={() => set('escalateMode', 'after')}
              >
                After a delay
              </Button>
              <Button
                size="sm"
                variant={form.escalateMode === 'at' ? 'solid' : 'outlined'}
                onClick={() => set('escalateMode', 'at')}
              >
                At a specific time
              </Button>
            </Stack>
          </FormControl>
          {form.escalateMode === 'after' ? (
            <FormControl>
              <FormLabel>How late</FormLabel>
              <DurationField
                value={Number(form.escalateAfterMinutes) || 15}
                onChange={(m) => set('escalateAfterMinutes', String(m))}
              />
            </FormControl>
          ) : (
            <FormControl>
              <FormLabel>Escalate at</FormLabel>
              <Input type="time" value={form.escalateAtTime} onChange={(e) => set('escalateAtTime', e.target.value)} />
            </FormControl>
          )}
        </Stack>
      )}

      <Divider />

      <Checkbox
        label="Email a contact if ignored"
        checked={form.escalateEmailEnabled}
        onChange={(e) => set('escalateEmailEnabled', e.target.checked)}
      />
      {form.escalateEmailEnabled && (
        <Stack spacing={2}>
          <FormControl>
            <FormLabel>Email address</FormLabel>
            <Input
              type="email"
              placeholder="name@example.com"
              value={form.escalateEmail}
              onChange={(e) => set('escalateEmail', e.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>How late</FormLabel>
            <DurationField
              value={Number(form.escalateEmailAfterMinutes) || 60}
              onChange={(m) => set('escalateEmailAfterMinutes', String(m))}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Email message (optional)</FormLabel>
            <Textarea
              minRows={2}
              placeholder={`The reminder "${form.title || 'this reminder'}" is overdue and hasn't been confirmed.`}
              value={form.escalateEmailMessage}
              onChange={(e) => set('escalateEmailMessage', e.target.value)}
            />
          </FormControl>
        </Stack>
      )}
    </Stack>
  )
}
