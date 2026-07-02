/**
 * Help / how it works. Plain-language explanation of the persistence model and
 * the Done/De-escalate/Snooze actions (the user-facing side of
 * docs/notification-behavior.md), plus the basics of creating reminders. Reached
 * from the top-bar help icon and a link in Settings.
 */
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Stack from '@mui/joy/Stack'
import Card from '@mui/joy/Card'
import Typography from '@mui/joy/Typography'
import Chip from '@mui/joy/Chip'
import Link from '@mui/joy/Link'
import { isNative } from '../native/alarmBridge.js'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="outlined">
      <Typography level="title-sm">{title}</Typography>
      {children}
    </Card>
  )
}

export function HelpPage() {
  return (
    <Stack spacing={2}>
      <Typography level="title-lg">Help</Typography>

      <Section title="What Persistent does">
        <Typography level="body-sm">
          Persistent is a reminder that doesn&apos;t give up. When a reminder is due it nags — a notification that
          keeps coming back (and can re-sound, or ring as a full alarm) — until you <b>explicitly mark it done</b>.
          Swiping it away isn&apos;t enough; that&apos;s the whole point.
        </Typography>
      </Section>

      <Section title="Creating a reminder">
        <Typography level="body-sm">
          Tap <b>New</b> on the Reminders screen. Give it a title, pick a category if you like (Task, Medication,
          Appointment), and set a schedule: a one-off time, or a repeat (daily, certain weekdays, every N days) with
          one or more times of day. Add optional details — for medications you can list what to take and the dose.
        </Typography>
      </Section>

      <Section title="How hard it nags: Persistent vs Alarm">
        <Typography level="body-sm">
          <b>Persistent</b> is a notification that re-appears until you confirm it, and can repeat a sound on an
          interval you choose. <b>Alarm</b> goes further: a looping sound and vibration that takes over the screen
          and can&apos;t be dismissed — only Done or Snooze clears it. Choose Alarm for things you must not sleep
          through.
        </Typography>
      </Section>

      <Section title="Escalation">
        <Typography level="body-sm">
          A Persistent reminder can <b>escalate to an alarm</b> if you ignore it — either after a number of minutes,
          or at a specific time of day. You can also set an <b>email contact</b> to be notified once a reminder is
          overdue, as a backstop in case you miss it on all your devices. (Alarm reminders already ring continuously,
          so they don&apos;t escalate.)
        </Typography>
      </Section>

      <Section title="Done, De-escalate, and Snooze">
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Chip size="sm" color="success" variant="soft">
              Done
            </Chip>
            <Typography level="body-sm">
              Marks the reminder complete and clears it <b>everywhere</b> — the alarm stops and the notification
              disappears on all your devices. This is the only action that ends the nag for good. To avoid an
              accidental tap, Done asks you to <b>confirm</b> once before it counts.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Chip size="sm" color="warning" variant="soft">
              De-escalate
            </Chip>
            <Typography level="body-sm">
              Appears on an escalated alarm. It <b>stops the alarm but keeps the reminder nagging</b> as the
              ordinary notification it was before escalating — it won&apos;t ring again for this firing, but it still
              isn&apos;t done. &ldquo;Stop yelling, but keep reminding me.&rdquo;
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Chip size="sm" color="neutral" variant="soft">
              Snooze
            </Chip>
            <Typography level="body-sm">
              Hides the reminder for a while and brings it back later. If it was ringing as an alarm, it rings again
              when the snooze ends — snoozing snoozes the alarm itself, it doesn&apos;t quietly downgrade it.
            </Typography>
          </Stack>
        </Stack>
      </Section>

      <Section title="Reminders with several times repeat independently">
        <Typography level="body-sm">
          Each time a reminder fires is its own item. If you take a medication at 9:00 and 1:00 and you haven&apos;t
          confirmed the 9:00 dose when 1:00 comes around, you&apos;ll see <b>both</b> — each with its own Done — and
          you confirm them <b>separately</b>. Marking the 1:00 dose done never silently clears the 9:00 one, so a
          missed dose is never lost.
        </Typography>
      </Section>

      <Section title="History">
        <Typography level="body-sm">
          The <b>History</b> tab lists past firings — what you confirmed and when — so you can check whether
          something was actually done.
        </Typography>
      </Section>

      <Section title={isNative() ? 'Permissions on this device' : 'Web vs the Android app'}>
        {isNative() ? (
          <Typography level="body-sm">
            For alarms to ring reliably, Android needs permission to schedule exact alarms, to show full-screen
            alarms, and to ignore battery optimizations for Persistent. You can set notification and alarm sounds and
            the default shade prominence in{' '}
            <Link component={RouterLink} to="/settings">
              Settings
            </Link>
            .
          </Typography>
        ) : (
          <Typography level="body-sm">
            On the web, notifications are <b>best-effort</b> — the browser can&apos;t guarantee an undismissable
            alarm or repeating sound while the tab is closed. For the real persistence guarantee (hard alarms that
            fire even offline), install the <b>Android app</b>. Enable browser notifications in{' '}
            <Link component={RouterLink} to="/settings">
              Settings
            </Link>
            .
          </Typography>
        )}
      </Section>
    </Stack>
  )
}
