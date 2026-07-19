/**
 * Public privacy policy. Reachable at /privacy WITHOUT signing in — Google Play
 * requires the policy URL to resolve for a logged-out crawler, so App.tsx routes
 * this ahead of the auth gate. Keep it factually in sync with
 * apps/api/prisma/schema.prisma and the delivery integrations in
 * apps/api/src/lib/delivery/.
 */
import Stack from '@mui/joy/Stack'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Link from '@mui/joy/Link'

// TODO(store): confirm this mailbox exists and is monitored before submitting to
// Play — Google verifies the contact route on the listing.
const CONTACT_EMAIL = 'privacy@persistent.dynamic-solutions.ca'

const LAST_UPDATED = '19 July 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography level="title-md" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Stack spacing={1}>{children}</Stack>
    </Box>
  )
}

export function PrivacyPage() {
  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', px: 2, py: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography level="h2">Privacy policy</Typography>
          <Typography level="body-xs">Last updated {LAST_UPDATED}</Typography>
        </Box>

        <Typography level="body-sm">
          Persistent is a reminder app. It stores the reminders you create and the record of whether you
          confirmed them, so it can nag you until you do. It does not sell your data, does not show ads, and
          contains no analytics or tracking software of any kind.
        </Typography>

        <Section title="What we collect">
          <Typography level="body-sm">
            <strong>Account.</strong> Your email address, which identifies your account and receives sign-in
            codes. If you sign in with Google, the name on your Google profile. Your time zone, so reminders
            fire at the local time you meant. There is no password — sign-in uses a one-time email code,
            Google, or a passkey.
          </Typography>
          <Typography level="body-sm">
            <strong>Your reminders.</strong> The title, details, schedule, and settings of every reminder you
            create. If you use the Medication category, that includes the medication names, doses, and units
            you enter — health information you have chosen to record.
          </Typography>
          <Typography level="body-sm">
            <strong>Reminder history.</strong> When each reminder fired, and whether and when you confirmed,
            snoozed, or ignored it.
          </Typography>
          <Typography level="body-sm">
            <strong>Devices.</strong> A push token or push endpoint for each device you enable notifications
            on, and the browser/device identifier string that came with it, so alarms can reach that device.
          </Typography>
          <Typography level="body-sm">
            <strong>Sessions.</strong> A hashed session secret and the browser identifier for each signed-in
            session, so you can stay signed in and we can expire sessions.
          </Typography>
          <Typography level="body-sm">
            We do not collect your location, contacts, photos, phone number, or payment details.
          </Typography>
        </Section>

        <Section title="Who your data is shared with">
          <Typography level="body-sm">
            Only the services needed to actually deliver a reminder. We do not share data with advertisers or
            data brokers.
          </Typography>
          <Typography level="body-sm">
            <strong>Google Firebase Cloud Messaging</strong> and your browser's push service (Google, Mozilla,
            or Apple, depending on your browser) deliver notifications to your devices. The notification
            payload includes the reminder's title and text.
          </Typography>
          <Typography level="body-sm">
            <strong>Cloudflare</strong> sends our email: your sign-in codes, and escalation emails.
          </Typography>
          <Typography level="body-sm">
            <strong>Google Sign-In</strong> is used only if you choose it, and returns your email address and
            profile name.
          </Typography>
          <Typography level="body-sm">
            <strong>Escalation contacts you choose.</strong> If you set a reminder to escalate by email, we
            send that address the reminder's title and any message you wrote. You control that address and
            what it says — please don't put anything there you wouldn't want that person to read.
          </Typography>
        </Section>

        <Section title="Security">
          <Typography level="body-sm">
            All traffic between your devices and our servers is encrypted with HTTPS, as is every request to
            the third parties above. Session secrets and email sign-in codes are stored only as one-way
            hashes. Reminder content is stored unencrypted in our database, so treat it as you would any
            hosted note-taking service and avoid recording anything you would not want held on a server.
          </Typography>
        </Section>

        <Section title="How long we keep it">
          <Typography level="body-sm">
            Reminders and their history are kept until you delete them or delete your account. Sign-in codes
            expire within minutes. Sessions expire on their own and can be revoked by signing out.
          </Typography>
        </Section>

        <Section title="Deleting your account">
          <Typography level="body-sm">
            Open <strong>Settings → Delete account</strong> in the app or on the web. Deletion is immediate
            and permanent: your account, reminders, history, passkeys, sessions, and device registrations are
            all removed, and there is no restore window.
          </Typography>
          <Typography level="body-sm">
            If you cannot sign in, email <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link> from the
            address on the account and we will delete it for you.
          </Typography>
        </Section>

        <Section title="Children">
          <Typography level="body-sm">
            Persistent is not directed at children under 13, and we do not knowingly collect their data.
          </Typography>
        </Section>

        <Section title="Not medical advice">
          <Typography level="body-sm">
            Persistent is not a medical device and does not provide medical advice. It reminds you about
            things you told it to remind you about. Do not rely on it as the sole safeguard for
            safety-critical medication.
          </Typography>
        </Section>

        <Section title="Contact">
          <Typography level="body-sm">
            Questions about this policy or your data: <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link>
          </Typography>
        </Section>
      </Stack>
    </Box>
  )
}
