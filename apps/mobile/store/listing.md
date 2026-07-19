# Google Play store listing — Persistent

Copy-paste source for the Play Console "Main store listing" page.
Package: `ca.persistent.app` · Category: Productivity

---

## App name (max 30 chars)

```
Persistent: Reminders That Nag
```

*(30/30. Fallback if you want it plainer: `Persistent — Reminders` (22).)*

## Short description (max 80 chars)

```
Reminders that nag until you confirm them done. Real alarms, not a silent ping.
```

*(78/80.)*

## Full description (max 4000 chars)

```
Every other reminder app lets you swipe the notification away and forget. Persistent doesn't.

A Persistent reminder keeps nagging until you explicitly confirm it's done. Dismiss the notification and it comes back. Ignore it long enough and it escalates into a full-screen alarm that rings and vibrates until you deal with it. It's built for the reminders you genuinely cannot afford to miss — medication, insulin, a dose you already forgot once this week.

WON'T TAKE A SWIPE FOR AN ANSWER
Marking a reminder Done is the only thing that ends it. Not dismissing it, not unlocking your phone, not tapping it by accident in your pocket — Done is a deliberate two-tap confirm on every surface.

REAL ALARMS, NOT NOTIFICATIONS
Choose how hard a reminder pushes:
• Notification — reappears until confirmed, with an optional re-sound interval
• Alarm — looping sound, vibration, and a full-screen wake-the-screen surface
• Escalation — starts as a quiet notification and automatically becomes an alarm if you haven't confirmed it after a set number of minutes, or by a set time of day

Alarms are scheduled on the device as exact alarms, so they fire on time even with no network connection and even when the app is closed.

EVERY DOSE IS ITS OWN REMINDER
If your 9:00 dose is still unconfirmed when the 13:00 dose fires, both nag — separately, each with its own Done. Confirming the afternoon one never silently erases the morning one you actually missed. Most reminder apps collapse these into one notification; that's exactly how a missed dose disappears.

THREE HONEST ACTIONS
• Done — confirms it and clears it from every device you own
• Snooze — clears it now and rings again later (snoozing an alarm re-rings an alarm; it doesn't quietly downgrade)
• De-escalate — stops an alarm from yelling but keeps the reminder nagging as a notification, so it still isn't finished

ESCALATE TO SOMEONE WHO'LL NOTICE
If a reminder goes unconfirmed, Persistent can escalate beyond the device in front of you — to your other devices, and to an email contact you choose. Useful when the person who needs the reminder isn't always the person who'll act on it.

WORKS IN THE CAR
Reminders project to Android Auto, and you can answer by voice — say "done", "snooze 15 minutes", or "de-escalate" without touching the phone. Reading a reminder aloud never counts as confirming it.

SYNCS EVERYWHERE, INSTANTLY
Confirm on your phone and it clears on your tablet and in your browser at the same moment. Manage reminders from any browser at persistent.dynamic-solutions.ca — the web app and the Android app are the same account, live-synced.

BUILT FOR MEDICATION
Tag a reminder as Medication and list what it's for — each drug with its dose and unit ("Ibuprofen 200 mg, Tylenol 500 mg"). The reminder tells you exactly what to take, and your history shows what you actually confirmed taking and when.

SCHEDULING
• One-off reminders at a date and time
• Daily, weekly, every-N-days, or fully custom day-of-week schedules
• Up to 24 times per day, per reminder
• Start and end dates, an option to skip weekends, and a pause switch
• Snooze by preset, a custom duration, or until a specific date and time
• Pick your own notification and alarm sounds
• Full history of what fired, what you confirmed, and when

SIGN IN WITHOUT A PASSWORD
There is no password to forget or leak. Sign in with a one-time email code, with Google, or with a passkey.

WHAT IT'S FOR
Medication and supplements. Insulin and blood sugar checks. Physio exercises. Watering, feeding, and dosing schedules. Anything where "I'll do it in a minute" has already cost you once.

WHAT IT ISN'T
Persistent is not a medical device and doesn't give medical advice. It reminds you; the judgment stays yours.

Persistent requires a free account so your reminders can sync across devices and escalate when you miss one.
```

*(~2,750 chars — comfortably inside the 4,000 limit.)*

---

## Graphics

| Asset | Spec | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit, no transparency | ✅ `graphics/play-icon.png` |
| Feature graphic | 1024×500 PNG/JPG, no transparency | ✅ `graphics/feature-graphic.png` |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | ❌ **must capture on device** |
| 7" / 10" tablet screenshots | optional | ❌ optional |

Sources are `graphics/*.svg`; re-render with
`rsvg-convert -w 512 -h 512 play-icon.svg -o play-icon.png`.

### Screenshots — the one asset I can't generate

Play needs real screenshots and they're the highest-leverage part of the listing.
Capture on the device (wireless ADB is already set up — see
`.devcontainer/adb-discover.py`):

```
adb exec-out screencap -p > apps/mobile/store/graphics/screen-1.png
```

Suggested five, in this order — lead with the thing no competitor has:

1. **A ringing full-screen alarm** with the two-tap Done armed (*"Won't take a swipe for an answer"*)
2. **The reminders list** with two pending occurrences of the same reminder (*"Every dose is its own reminder"*)
3. **The editor** showing the escalation settings (*"Nags harder if you ignore it"*)
4. **A notification** with Done / Snooze / De-escalate visible (*"Three honest actions"*)
5. **Android Auto** or the history view (*"Answer by voice"* / *"See what you actually confirmed"*)

Use a clean demo account — no real medication names in a public listing.

---

## Store settings

- **App category:** Productivity *(Health & Fitness is tempting but invites medical-app scrutiny; Productivity is the safer classification)*
- **Tags:** Reminders, To-Do Lists, Productivity
- **Content rating questionnaire:** no objectionable content → Everyone. Answer **yes** to "users can communicate" only if the email-escalation contact counts as user-to-user messaging — it's a one-way system email, so **no** is defensible.
- **Contact email:** required, publicly displayed
- **Privacy policy URL:** required (account + email collection) — see blockers
- **Ads:** No
- **In-app purchases:** No

---

## Data safety declaration

Verified against `apps/api/prisma/schema.prisma`. All types are **collected and
linked to the user**; none are used for advertising, analytics, or tracking (the
repo contains **no** analytics or crash-reporting SDK — grep for sentry /
crashlytics / firebase-analytics / posthog / amplitude / gtag returns zero hits).

| Play data type | Collected | Shared | Purpose | Notes |
| --- | --- | --- | --- | --- |
| Email address | Yes | Yes | Account management, app functionality | Sign-in codes via Cloudflare; user-set escalation contact |
| Name | Yes | No | Account management | `displayName`, only if signing in with Google |
| **Health info** | Yes | Yes | App functionality | Medication category stores drug name + dose; push payloads carry titles |
| Other user-generated content | Yes | Yes | App functionality | Reminder titles/details, sent in push payloads and escalation emails |
| Device or other IDs | Yes | Yes | App functionality | Web Push endpoints / FCM tokens |
| App activity / other actions | Yes | No | App functionality | Occurrence log: fired, acknowledged, snoozed times |

**Declare sharing = Yes.** Three third parties receive user data as a functional
necessity: Google FCM and browser push services (reminder title + body in push
payloads), and Cloudflare Email Sending (sign-in codes; escalation emails
containing the reminder title and the user's message, sent to an address the user
chooses). None is a "transfer for advertising."

Security practices to declare:
- ✅ Data is encrypted in transit (HTTPS everywhere; `cleartext: false`, HSTS-style proxy, `Secure`/`HttpOnly` session cookie)
- ⚠️ **At rest, Postgres columns are plaintext** — only session secrets and email codes are hashed. Don't over-claim encryption at rest.
- ❌ **"Users can request data deletion" — you cannot truthfully claim this yet.** See blockers.

Because the app stores medication names and doses, expect Play to route the
listing through **health-app review**. Keep the "not a medical device" line in the
full description; it's doing real work there.
