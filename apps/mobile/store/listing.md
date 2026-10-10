# Google Play store listing — Persistent

Copy-paste source for the Play Console "Main store listing" page.
Package: `ca.dynamicsolutions.persistent` (Play) · Category: Productivity

The sideloaded GitHub build keeps `ca.persistent.app`; only the Play flavor carries
the new applicationId, so the two can coexist on a device.

> Medication reminders are available again under the organization developer account.
> Keep this listing, its screenshots, the privacy policy, and Play Console's Health apps
> and Data safety declarations aligned with the hosted app.

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

A Persistent reminder keeps nagging until you confirm it. Dismiss it and it comes back. Ignore it long enough and it can escalate into a full-screen alarm.

WON'T TAKE A SWIPE FOR AN ANSWER
Marking a reminder Done is the only thing that ends it. Not dismissing it, not unlocking your phone, not tapping it by accident in your pocket — Done is a deliberate two-tap confirm on every surface.

REAL ALARMS, NOT NOTIFICATIONS
Choose how hard a reminder pushes:
• Notification — reappears until confirmed, with an optional re-sound interval
• Alarm — looping sound, vibration, and a full-screen wake-the-screen surface
• Escalation — starts as a quiet notification and automatically becomes an alarm if you haven't confirmed it after a set number of minutes, or by a set time of day

Alarms are scheduled on the device as exact alarms, so they fire on time even with no network connection and even when the app is closed.

EVERY FIRING IS ITS OWN REMINDER
Set a reminder for 9:00 and 13:00 and they are two separate obligations. If the 9:00 one is still unconfirmed when 13:00 fires, both nag, each with its own Done. Confirming one never silently erases the other.

THREE HONEST ACTIONS
• Done — confirms it and clears it for everyone sharing that firing
• Snooze — clears it now and rings again later (snoozing an alarm re-rings an alarm; it doesn't quietly downgrade)
• De-escalate — stops an alarm from yelling but keeps the reminder nagging as a notification, so it still isn't finished

ESCALATE TO SOMEONE WHO'LL NOTICE
If a reminder goes unconfirmed, Persistent can escalate beyond the device in front of you — to your other devices, and to an email contact you choose. Useful when the person who needs the reminder isn't always the person who'll act on it.

SYNCS EVERYWHERE, INSTANTLY
Confirm on your phone and it clears on your tablet and in your browser at the same moment. Manage reminders from any browser at persistent.dynamic-solutions.ca — same account, live-synced.

SHARE THE REMINDER
Invite someone by email, even if they have not signed up yet. Everyone with access can edit the reminder and mark it done for the group. Each person's snooze and alarm escalation stay personal.

CHECKLISTS
List items and tick them off as you go. Each firing tracks its own ticks, so a repeating checklist starts fresh every time. Hide finished items on every device. Ticking the last item still does not confirm the reminder.

ASSIGN IT TO SOMEONE ELSE
Create a reminder for one other person. They own the alerts and can edit, finish or decline it. Track each firing and its completion time in your Assigned by me view.

MEDICATION REMINDERS
Keep the medicine name and dose with a reminder. Persistent is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Consult a healthcare professional for medical advice, diagnosis, or treatment.

SCHEDULING
• One-off reminders at a date and time
• Daily, weekly, every-N-days, or fully custom day-of-week schedules
• Monthly on the days you choose — the 1st, the 1st and 15th, or the last day of every month
• Up to 24 times per day, per reminder
• Start and end dates, an option to skip weekends, and a pause switch
• Snooze by preset, a custom duration, or until a specific date and time
• Pick your own notification and alarm sounds
• Full history of what fired, what you confirmed, and when

SIGN IN WITHOUT A PASSWORD
There is no password to forget or leak. Sign in with a one-time email code, with Google, or with a passkey.

WHAT IT'S FOR
Medication, watering, feeding, bins out, physio, timesheets and renewals. Anything where "I'll do it in a minute" has already cost you once.

Persistent requires a free account so your reminders can sync across devices and escalate when you miss one.
```

Validate the character count with `node apps/mobile/scripts/play-publish.mjs --listing
apps/mobile/store/listing.md --check` before publishing.

---


> **No Android Auto copy here, deliberately.** The description carried a "WORKS IN THE
> CAR" section until 2026-08-18. The Play build no longer projects to Auto at all (the
> `com.google.android.gms.car.application` declaration is direct-only — see
> `docs/alarm-architecture.md`), so the claim became false, and an Auto claim in the
> listing is also what invites the Auto review that flagged the app as a messaging app
> in the first place. The sideloaded build still does it; the store copy must not say so.


## Graphics

| Asset | Spec | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit, no transparency | ✅ `graphics/play-icon.png` |
| Feature graphic | 1024×500 PNG/JPG, no transparency | ✅ `graphics/feature-graphic.png` |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | ✅ 8 in `graphics/screenshots/` (see below) |
| 7" / 10" tablet screenshots | optional | ❌ optional |

Sources are `graphics/*.svg`; re-render with
`rsvg-convert -w 512 -h 512 play-icon.svg -o play-icon.png`.

### Capturing more

Use the [repeatable store screenshot workflow](../../../store-assets/README.md).
It prepares a protected synthetic demo account, captures all eight source screens
in the isolated Android demo app, and renders reusable phone mockups through the
shared Paseo browser. `npm run shots`
prints the workflow entrypoint; it does not launch or install a browser.

**Always capture against the demo account, never a real one.** The owner's real
account contains actual prescriptions; a Play listing is public and permanent.
Native captures require a separately requested device session. Every image
includes the real status area and gesture bar, with no unrelated notification icons. Keep native permission demonstration videos separate from the carousel.

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

Do not paste the real code into this file: it is a shared secret and this repo is
public. Keep it in the server `.env` and the Play Console form only.

**Set it fresh for each submission and clear both vars once the review concludes.**
The code never expires, so leaving it set between reviews is a standing credential on
an account whose address this file names. Unsetting `REVIEW_ACCOUNT_EMAIL` and
`REVIEW_ACCOUNT_CODE` in the production env removes the path with no other effect
(`docs/auth-architecture.md`), and the next submission simply sets it again. Cleared
after the production approval of 2026-09-05.

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
| Other user-generated content | Yes | Yes | App functionality | Reminder titles/details, sent in push payloads and escalation emails |
| Health info | Yes | Yes | App functionality | Medication names and doses; reminder text can reach FCM push and user-chosen escalation email |
| Device or other IDs | Yes | Yes | App functionality | FCM device tokens |
| App activity / other actions | Yes | Yes | App functionality | Occurrence log: fired, acknowledged, snoozed times; assignment creators can see firing status and completion times |

**Declare sharing = Yes.** Google FCM receives reminder titles and bodies in push
payloads. Cloudflare Email Sending handles sign-in codes and invitation and
escalation emails. A user can share reminder content with other participants,
and an assignment creator can see the assignee's firing and completion status.
None of this is a transfer for advertising.

Security practices to declare:
- ✅ Data is encrypted in transit (HTTPS everywhere; `cleartext: false`, HSTS-style proxy, `Secure`/`HttpOnly` session cookie)
- ⚠️ **At rest, Postgres columns are plaintext** — only session secrets and email codes are hashed. Don't over-claim encryption at rest.
- ✅ **"Users can request data deletion" is true, so claim it.** Two routes, both live: in-app at Settings → Delete account, and the public URL above for anyone who cannot sign in. `DELETE /api/auth/me` requires the caller to type their own email, so a session cookie alone will not fire it. Verified end to end against a throwaway account: the user, reminders, occurrences, sessions and the `EmailCode` rows (keyed by address, so they have no cascade and are deleted explicitly) all go.

Medication reminders store medicine names and doses. The Health info row above
must be restored in Play Console's Data safety form and Medication and Treatment
Management selected in its Health apps declaration. Check the current published
forms before marking this complete.

---

## Captured screenshots

All eight live in `graphics/screenshots/`, using the seeded demo account with
synthetic health data only. All eight are full-display Pixel 9 Pro captures with
the real status area and gesture bar, and no unrelated notification icons.
All are composed in Paseo
inside reusable phone mockups, with 1080 x 1920 RGB PNG exports. Marketing copy
describes the feature without theme names.
Ordered as they should appear in Play:

| File | Shows | Theme |
| --- | --- | --- |
| `00-current-light.png` | Current reminders for plants, puppy, and the morning checklist | Enjoy Light |
| `01-notification-shade.png` | Four distinct reminders, native Done and Snooze actions, and copy explaining that swiped notifications return until confirmed | Android system |
| `02-alarm-dark.png` | Real ignored-reminder escalation into an alarm with Done, Snooze, and De-escalate controls | Enjoy Dark |
| `03-checklist-dark.png` | Reading dialog with a part-completed checklist and reminder controls below it | Enjoy Dark |
| `04-medication-light.png` | Synthetic vitamin reminder editor with medicine name and 1000 IU dose | Enjoy Light |
| `05-sharing-dark.png` | Share or assign dialog with a staged sample recipient | Enjoy Dark |
| `06-notes-light.png` | Trip-packing note checklist, without an alarm | Enjoy Light |
| `07-assigned-dark.png` | Assigned by me status with a synthetic completion record | Enjoy Dark |

The root README embeds `00`, `03`, and `05` from this directory, without separate
copies. Native permission videos remain separate.
No screen repeats a reminder as two near-identical cards.

### Regenerating

Use [store-assets/README.md](../../../store-assets/README.md) and its manifest.
Prepare the synthetic fixture, capture all eight screens in the isolated Android
demo app through the authorized device session, then render
the phone layouts and capture their final exports. If waiting has allowed another
scheduled firing to create duplicate demo cards, refresh the protected fixture
before capture and synchronize the demo app again:

```sh
npm run shots:prepare -- --email=ryan.ewen+persistentdemo@gmail.com
npm run shots:render
npm run shots:check
npm run shots:sync
```

`shots:prepare` runs in the isolated development stack; the capture and render steps
between commands are documented in the workflow. `shots:sync` replaces the local
upload directory only. Publish the listing separately when requested.

### Video

`graphics/video/` holds screen recordings, all 960x2142, captured on the demo
account so no real medication data appears.

**Marketing** (optional, for the promo slot):

- `swipe-away-comes-back.mp4` (16s) — swiping the notification away; it re-posts itself.
- `two-step-done.mp4` (16s) — Done arms "Confirm done" / "Not yet"; confirming clears the card.

**Permission declarations** (required — Play asks for a demonstration video for
each of these; see `play-readiness.md` §5):

| File | Declaration | Shows |
| --- | --- | --- |
| `permission-foreground-service.mp4` (36s) | Foreground Service | Alarm rings, app backgrounded, keeps ringing via the service, ongoing notification in the shade |
| `permission-full-screen-intent.mp4` (42s) | Full-screen intent | Device locked, alarm fires, full-screen surface over the lock screen |
| `permission-exact-alarm.mp4` (18s) | Exact alarms | Reminder scheduled for a set minute, firing exactly at it |

`permission-exact-alarm-frame.png` is a still from that last recording showing the
surface at the scheduled minute, if a reviewer wants a static reference.

**Every video slot in Play takes a YouTube URL, not a file upload.** Put these up
as unlisted and paste the links — the `.mp4`s here are source, not listing assets.

### Reproducing

Sign in as the demo account (`ryan.ewen+persistentdemo@gmail.com`), then note that
a repeating schedule only materializes *forward* from now — to get already-passed
firing times, create the reminder as `once` with the past times (the server
back-fills within `MATERIALIZE_WINDOW_MS`, 48h), let both fire, then edit it to
`daily`. The fired occurrences survive that edit by design
(`docs/notification-behavior.md` §6), so the card shows believable times of day
instead of firings a couple of minutes apart.
