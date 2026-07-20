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
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | ✅ 5 in `graphics/screenshots/` (see below) |
| 7" / 10" tablet screenshots | optional | ❌ optional |

Sources are `graphics/*.svg`; re-render with
`rsvg-convert -w 512 -h 512 play-icon.svg -o play-icon.png`.

### Capturing more

Wireless ADB is already set up (`.devcontainer/adb-discover.py`; the phone's
wireless-debug port rotates every time the toggle is flipped):

```
adb exec-out screencap -p > shot.png
adb shell screenrecord --time-limit 20 /sdcard/v.mp4 && adb pull /sdcard/v.mp4
```

**Always capture against the demo account, never a real one.** The owner's real
account contains actual prescriptions; a Play listing is public and permanent.

---

## Store settings

- **App category:** Productivity *(Health & Fitness is tempting but invites medical-app scrutiny; Productivity is the safer classification)*
- **Tags:** Reminders, To-Do Lists, Productivity
- **Content rating questionnaire:** no objectionable content → Everyone. Answer **yes** to "users can communicate" only if the email-escalation contact counts as user-to-user messaging — it's a one-way system email, so **no** is defensible.
- **Contact email:** `contact@dynamic-solutions.ca` (required, publicly displayed — same address as the privacy policy)
- **Privacy policy URL:** `https://persistent.dynamic-solutions.ca/privacy`
- **Account deletion URL** (Data safety → *Provide a way for users to request account deletion*): `https://persistent.dynamic-solutions.ca/delete-account` — resolves signed out, explains the in-app route and gives an email fallback
- **Ads:** No
- **In-app purchases:** No

### App access (required — the whole app is behind sign-in)

Play reviewers must be given working credentials, and they cannot use any normal
path here: sign-in is passwordless (emailed one-time code, Google, or passkey) and
a reviewer has no access to the mailbox. A designated review account can therefore
sign in with a fixed code — see `docs/auth-architecture.md` and set
`REVIEW_ACCOUNT_EMAIL` / `REVIEW_ACCOUNT_CODE` in the **production** env.

Choose "All functionality is restricted" and give one instruction set:

```
Username / email:  <REVIEW_ACCOUNT_EMAIL>
Password / code:   <REVIEW_ACCOUNT_CODE>

Instructions:
1. Open the app and tap "Use email instead".
2. Enter the email address above, then tap "Send sign-in code".
3. Enter the code above and tap "Sign in".
   (This account uses a fixed code; no email is sent and none is needed.)

The account is pre-populated with example reminders. To see the core behaviour,
open a reminder that is due and tap Done — it asks for a second confirming tap,
which is the app's central guarantee: a reminder is only cleared by an explicit
confirmation, never by dismissing a notification.
```

Do not paste the real code into this file — it is a shared secret and this repo is
version-controlled. Keep it in the server `.env` and the Play Console form only,
and rotate it once the review concludes.

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

---

## Captured screenshots

In `graphics/screenshots/`, taken on a Pixel 9 Pro (960x2142) against a **demo
account** — no real medication data. Ordered as they should appear in Play.

| File | Shows |
| --- | --- |
| `00-ringing-alarm.png` | The full-screen alarm, mid two-tap confirm — the thing no other reminder app does. Lead with this. |
| `01-independent-doses.png` | Two unconfirmed Amoxicillin doses (8:00 a.m. + 2:00 p.m.) nagging separately — the differentiator |
| `02-reminder-detail.png` | Reminder detail: daily 3x schedule, both doses under "Needs attention" |
| `03-escalation-settings.png` | Escalate-to-alarm settings: delay presets, escalate-at-a-time, email a contact |
| `04-notification-actions.png` | Notification with Done / Snooze, two doses stacked (cropped to 9:16; quick-settings removed) |
| `05-history.png` | History: what was confirmed and when |

All five plus the ringing alarm are captured. The alarm shot was taken on Android
15 with a neutral reminder title and contains no personal data.

### Video

`graphics/video/` holds two screen recordings (16s each, 960x2142):

- `swipe-away-comes-back.mp4` — swiping the notification away; it re-posts itself.
- `two-step-done.mp4` — Done arms "Confirm done" / "Not yet"; confirming clears the card.

Play's promo-video slot takes a **YouTube URL**, not an upload, so these are raw
source for editing/uploading rather than direct listing assets.

### Reproducing

Sign in as the demo account (`ryan.ewen+persistentdemo@gmail.com`), then note that
a repeating schedule only materializes *forward* from now — to get already-passed
dose times, create the reminder as `once` with the past times (the server
back-fills within `MATERIALIZE_WINDOW_MS`, 48h), let both fire, then edit it to
`daily`. The fired occurrences survive that edit by design
(`docs/notification-behavior.md` §6), so the card shows real dose times instead of
firings a couple of minutes apart.
