# Google Play store listing — Persistent

Copy-paste source for the Play Console "Main store listing" page.
Package: `ca.dynamicsolutions.persistent` (Play) · Category: Productivity

The sideloaded GitHub build keeps `ca.persistent.app`; only the Play flavor carries
the new applicationId, so the two can coexist on a device.

> **No health framing while the Medication type is withheld.** Play requires an
> organization developer account for an app that handles health data, and the
> switch from an individual account takes up to 30 days. Until it lands the app
> does not offer the Medication type (`selectableReminderTypes` in
> `packages/shared/src/reminders.ts`), so this listing must not advertise
> medication, doses or "not a medical device" — that copy is what routes a listing
> into health-app review. Everything withheld here goes back at the same time the
> type does; the removed passages are recoverable from git history.
>
> **Screenshots:** all six are regenerated and medication-free (see *Captured
> screenshots*). Play reads the images as much as the copy, so any future edit to
> this listing has to keep them in step.

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

A Persistent reminder keeps nagging until you explicitly confirm it's done. Dismiss the notification and it comes back. Ignore it long enough and it escalates into a full-screen alarm that rings and vibrates until you deal with it. It's built for the reminders you genuinely cannot afford to miss — the ones you already forgot once this week.

WON'T TAKE A SWIPE FOR AN ANSWER
Marking a reminder Done is the only thing that ends it. Not dismissing it, not unlocking your phone, not tapping it by accident in your pocket — Done is a deliberate two-tap confirm on every surface.

REAL ALARMS, NOT NOTIFICATIONS
Choose how hard a reminder pushes:
• Notification — reappears until confirmed, with an optional re-sound interval
• Alarm — looping sound, vibration, and a full-screen wake-the-screen surface
• Escalation — starts as a quiet notification and automatically becomes an alarm if you haven't confirmed it after a set number of minutes, or by a set time of day

Alarms are scheduled on the device as exact alarms, so they fire on time even with no network connection and even when the app is closed.

EVERY FIRING IS ITS OWN REMINDER
Set a reminder for 9:00 and 13:00 and they are two separate obligations. If the 9:00 one is still unconfirmed when 13:00 fires, both nag — each with its own Done. Confirming the afternoon one never silently erases the morning one you actually missed. Most reminder apps collapse these into one notification; that's exactly how the missed one disappears.

THREE HONEST ACTIONS
• Done — confirms it and clears it from every device you own
• Snooze — clears it now and rings again later (snoozing an alarm re-rings an alarm; it doesn't quietly downgrade)
• De-escalate — stops an alarm from yelling but keeps the reminder nagging as a notification, so it still isn't finished

ESCALATE TO SOMEONE WHO'LL NOTICE
If a reminder goes unconfirmed, Persistent can escalate beyond the device in front of you — to your other devices, and to an email contact you choose. Useful when the person who needs the reminder isn't always the person who'll act on it.

WORKS IN THE CAR
Reminders project to Android Auto, and you can answer by voice — say "done", "snooze 15 minutes", or "de-escalate" without touching the phone. Reading a reminder aloud never counts as confirming it.

SYNCS EVERYWHERE, INSTANTLY
Confirm on your phone and it clears on your tablet and in your browser at the same moment. Manage reminders from any browser at persistent.dynamic-solutions.ca — same account, live-synced.

CHECKLISTS
Some reminders cover several things at once. Tag one as a Checklist, list the items, and tick them off as you go — each firing tracks its own ticks, so a repeating checklist starts fresh every time. Hide the ticked ones to see just what's left, on every device. It still keeps nagging until you confirm it: ticking the last item doesn't let you off the hook.

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
Watering, feeding, and cleaning schedules. Bins out on the right night. Physio and stretches. Timesheets, invoices, and renewals. Anything where "I'll do it in a minute" has already cost you once.

Persistent requires a free account so your reminders can sync across devices and escalate when you miss one.
```

*(3,880 of the 4,000 characters — 120 spare. Don't hand-count this: the figure
this note used to carry was wrong by 1,500 and the description sat over the limit
unnoticed, and* `wc -m` *reports bytes unless the locale is UTF-8, which
over-counts every* — *and* • *by two. The publisher is the authority and refuses
to push an over-limit description:*
`node scripts/play-publish.mjs --listing store/listing.md --check`*.)*

---

## Graphics

| Asset | Spec | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit, no transparency | ✅ `graphics/play-icon.png` |
| Feature graphic | 1024×500 PNG/JPG, no transparency | ✅ `graphics/feature-graphic.png` |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | ✅ 6 in `graphics/screenshots/` (see below) |
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
The in-app shots are scripted now (`npm run shots`) and never touch a phone; only
the alarm and the notification shade still need adb.

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

**Health info was declared here and is not any more**, because the Medication type
is withheld from the picker — the app collects no new drug names or doses. Restore
the row (`Health info | Yes | Yes | App functionality | Medication reminders store
drug name + dose; push payloads carry titles`) the moment the type comes back;
until it does, expect the listing to skip **health-app review**, which is the point
of withholding it.

One caveat worth resolving before you submit: reminders created *before* the type
was withheld keep their doses, and are still displayed, still edited as
medications, and still sent in push payloads. No new user can produce that data —
but if Play's reading of "collects" covers data the app still stores and
transmits for existing users, the row belongs back on the form. Confirm which way
you're declaring it rather than assuming this file settled it.

---

## Captured screenshots

All six live in `graphics/screenshots/`, taken against the seeded demo account and
free of health data. Ordered as they should appear in Play.

The root `README.md` embeds three of them — `00`, `01` and `04` — from this
directory directly rather than keeping its own copies, so regenerating those
updates the README too, and renaming one breaks it. That is deliberate: the same
"no health framing" constraint applies in both places, and two copies would drift.

| File | Shows | Size | Source |
| --- | --- | --- | --- |
| `00-ringing-alarm.png` | The full-screen alarm mid two-tap confirm — the thing no other reminder app does. Lead with this. | 960x2142 | device |
| `01-current.png` | Three distinct reminders still waiting to be confirmed, each with its own Done | 1120x2495 | `npm run shots` |
| `02-reminder-detail.png` | Reminder detail: the 3x daily schedule and what it is still waiting on | 1120x2495 | `npm run shots` |
| `03-escalation-settings.png` | Escalate-to-alarm settings: delay presets, escalate-at-a-time, email a contact | 1120x2495 | `npm run shots` |
| `04-notification-actions.png` | Notification shade: Done / Snooze on the notification itself, five distinct reminders nagging | 960x1425 | device |
| `05-history.png` | History: what was confirmed and when | 1120x2495 | `npm run shots` |

Sizes differ between the scripted and device shots; the aspect ratios match to
within a rounding error (0.449 vs 0.448) and Play scales them, so the carousel
still reads as one set.

**No screen repeats a reminder.** Two cards for one reminder is the app's headline
behavior, but as a picture it reads as a duplicate bug — two identical cards
separated only by a timestamp. The copy makes that claim in words instead. Keep it
that way.

### Regenerating

> ⚠️ **The set predates two UI passes and is due a regeneration with the release
> that ships them.**
>
> - **The New reminder FAB.** `01` still shows the old full-width "New reminder"
>   bar above the cards, and `05` (History) has no create action at all — both now
>   carry a floating button (`apps/web/src/components/NewReminderFab.tsx`).
> - **Headings and their one-line subtitles.** Every screen title now goes through
>   `apps/web/src/components/SectionHeading.tsx`, and the subtitle copy under each
>   was shortened — so `01`, `02`, `03` and `05` all show wording and spacing that
>   no longer match the app.
>
> Left alone deliberately: these are store assets and should match the build a
> user can actually download, which has neither change yet. Regenerate at release
> time, not before. `00` and `04` are native/OS surfaces and unaffected by both.

Four of the six are scripted. Do the whole set in one go — the copy and the UI both
move, and this set went stale twice over before anyone noticed (medication content,
then a fourth nav tab):

```
npm run dev                                        # web + api
npm run db:seed:demo -- --email=<demo account>     # the reminders the shots need
npm run shots -- --email=<demo account>            # renders 01/02/03/05
```

Seed after 6:30 p.m. local or the "Due" cards date themselves yesterday and say so.

**`00` and `04` need a real device** — the full-screen alarm is a native Kotlin
activity (`AlarmActivity.kt`) and the shade is Android's own chrome, so no browser
can produce either. To retake them, sign the phone into the demo account (the
`REVIEW_ACCOUNT_CODE` fixed code works, so no mailbox is needed), then:

- **`04`**: move two PENDING occurrences of *different* reminders to a minute out
  and let the live scheduler fire them; pull the shade, expand the group, expand
  one entry so its Done/Snooze show. Crop the quick-settings band out and stitch
  the status bar back on (`magick … -crop … -append`).
- **`00`**: flip a reminder to `ALARM` and add an occurrence a minute out. **A
  direct database write is not enough** — the device arms its own alarms from
  `/api/sync/occurrences`, and a row inserted behind the API sends no sync nudge,
  so nothing rings until the app is foregrounded and syncs. Foreground it, then tap
  Done once to reach the "Confirm done / Not yet" state before capturing.

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
