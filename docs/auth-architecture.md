# Auth architecture

Passwordless, single-user ownership. Adapted (much thinner) from printstream's
auth: no tenancy, no roles, no service accounts.

## Sign-up = sign-in (email one-time code)

1. `POST /api/auth/request-code` with an email. We create a hashed, single-use,
   10-minute `EmailCode` and email it via Cloudflare (`lib/email-code.ts`). In
   `DEMO_MODE` (or when email is unconfigured) the cleartext code is returned in
   the response as `previewCode` so local dev needs no mail infra.
2. `POST /api/auth/verify-code` with email + code (+ the browser's IANA time
   zone). On success we `upsert` the `User` (so first-time = sign-up, with email
   inherently verified) and start a session. No passwords, so no password reset.

Rate limiting: per-email (`lib/email-code.ts`) and per-IP (`lib/rate-limit.ts`)
on code requests; capped verify attempts per code.

## Passkeys (WebAuthn)

An alternative to the email code: a signed-in user can register a passkey
(Settings → Passkeys), then sign in with a single biometric/PIN gesture — no
email round-trip. Implemented with `@simplewebauthn/server` + `/browser`
(`lib/webauthn.ts`, routes under `/api/auth/passkey/*`), credentials stored in
the `Passkey` model.

- **Registration** (authenticated): `register/options` → browser
  `startRegistration` → `register/verify` stores the credential's public key.
- **Authentication** (anonymous): discoverable credentials (`residentKey:
  required`), so `authenticate/options` → `startAuthentication` →
  `authenticate/verify` looks up the credential, verifies the assertion, and
  starts a normal session — the same cookie as the email flow.
- The in-flight challenge is held in a short HttpOnly cookie
  (`persistent_pk_challenge`), validated on verify.
- **Relying party**: RP ID + allowed origins derive from `CLIENT_ORIGIN`
  (hostname = RP ID). The native app's origin is `android:apk-key-hash:<…>` (not
  the https URL), so that origin is also accepted (`ANDROID_APP_ORIGIN` in
  `webauthn.ts`, kept in sync with the cert in `assetlinks.json`). The login UI
  offers passkey first, with email as fallback.

Native app: the WebView has no `navigator.credentials`, so the native
`PasskeyPlugin` (androidx.credentials Credential Manager) performs the ceremony —
`passkeyClient.ts` routes to it when `isNative()`, else to the browser API. This
requires a Digital Asset Links file at `/.well-known/assetlinks.json` (served
from `apps/web/public`) listing the app package + cert SHA-256, which authorizes
the app for the RP.

**One entry per flavor, because the two install under different package names.**
Credential Manager matches package *and* certificate on-device, so a package the
file does not name fails the ceremony before any request reaches the server, and
no server setting can rescue it:

| Flavor | Package | Signed by |
| --- | --- | --- |
| `direct` (sideloaded) | `ca.persistent.app` | the release keystore |
| `play` (Store) | `ca.dynamicsolutions.persistent` | Google, via Play App Signing |

The app is enrolled in Play App Signing, so Play re-signs the bundle and the Play
build's certificate is Google's, not the upload key's. Both entries must be present
here and both origins in `ANDROID_APP_ORIGIN`; `npm run android:origin -- <SHA-256>`
converts a fingerprint to the origin form.

This was wrong from the moment the Play flavor got its own `applicationId` until
production opened on 2026-09-05: only `ca.persistent.app` was listed, so passkeys
were dead on every Play build while working perfectly on the sideloaded one a
developer tests with. If a flavor, package name or signing key ever changes again,
this file is the thing to change with it.

⚠️ **Do not paste Play Console's Digital Asset Links snippet over this file.** The
App signing page offers one and invites you to merge it, but it declares
`delegate_permission/common.handle_all_urls`, which is Android App Links. Passkeys
need `delegate_permission/common.get_login_creds`. Merging the two relations is
harmless; replacing the file with the Console's version silently kills passkeys on
both builds. The app declares no `autoVerify` intent filter and claims no web URLs,
so the App Links statement is not wanted at all.

## Sign in with Google

Optional third method (enabled when `GOOGLE_CLIENT_ID` is set; the client reads
`GET /api/auth/config` to decide whether to show it). The client obtains a Google
**ID token** — web via Google Identity Services, native via the Credential Manager
Google ID option (`GoogleAuthPlugin`) — and posts it to `POST /api/auth/google`,
which verifies it (`google-auth-library`, audience = `GOOGLE_CLIENT_ID`), requires
a verified email, upserts the user **by email** (so it links to the same account
as the email-code / passkey methods), and starts the usual session.

Native requires an Android OAuth client registered for the package + signing
SHA-1; the web client id is passed as the `serverClientId`. This has the same
per-flavor split as passkeys above, and the same failure mode: no matching client,
no sign-in, with nothing server-side to adjust.

| Flavor | Package | SHA-1 to register |
| --- | --- | --- |
| `direct` | `ca.persistent.app` | `8D:36:D5:65:2D:7A:AB:4F:C8:E9:33:87:C4:3D:F1:5F:7B:E3:01:15` (release keystore, a.k.a. the **upload key**) |
| `play` | `ca.dynamicsolutions.persistent` | `AC:47:C4:96:38:A1:0A:00:70:B7:82:E7:AC:B4:E7:CC:1D:D9:5E:23` (Play's **app signing key**) |

**The upload key is not the app signing key**, and Play Console's App signing page
lists both, which is how the wrong one gets registered. You sign with the upload
key; Google re-signs with the app signing key; users install what Google signed. A
client bound to the upload key therefore matches the sideloaded build and never a
Play install. As of 2026-09-05 only the `direct` row existed, so native Google
sign-in was unavailable on Play exactly as passkeys were, for the same reason one
layer along.

To check: Google Cloud console → APIs & Services → Credentials → OAuth 2.0 Client
IDs, look for an **Android** client per row above. Play Console → Setup → App
signing is where the Play values come from.

**Register these in the project that owns `GOOGLE_WEB_CLIENT_ID`** (client
`20949993505-…`), because the server verifies the ID token with that client as the
audience. Note this is *not* the Firebase project: FCM lives in `persistent-7c99a`
(project number `157199800668`) and has both package names registered for push, so
its "add a SHA-1 to the Android app" flow looks like the right shortcut and creates
the client in the wrong project.

## Sessions

Cookie-backed (`lib/auth-session.ts`). A random secret lives only in the
`persistent_auth` cookie (HttpOnly, SameSite=Lax, Secure on HTTPS); the database
stores its SHA-256 hash. Sessions idle-refresh on a **sliding 7-day** window:
every authenticated request (in-app action, or a notification ack/snooze/sync)
extends expiry to now + 7 days (throttled to ~5 min); a week idle signs out. The
`/ws` upgrade authenticates with the same cookie. The native background
`SyncWorker` (see `docs/alarm-architecture.md`) also authenticates with this
cookie — but its process has no WebView, so it can't read the HttpOnly cookie from
`CookieManager`; the WebView captures it and mirrors it into native storage for the
worker. Its ~15-min syncs then keep the session alive as long as the app is
installed and periodically online.

The **Windows tray app** is the other non-browser caller, when its optional
notifications are on: its `/ws` client and the ack/snooze behind a toast button
read the cookie straight out of the WebView2 profile per call
(`AppFlyout.GetSessionCookieAsync`). Unlike the Android worker it caches nothing
and mirrors nothing — it has a WebView right there — so a refreshed session is
picked up automatically and signing out simply makes its calls fail. Nothing about
the session is written to `settings.json`.

`attachUser` middleware resolves the cookie into `request.userId` for every
request; `requireUser` rejects anonymous callers; `requireUserId(request)`
returns the id inside handlers.

## Data isolation

The whole boundary is: **every domain query filters by `userId`.** There is no
row-level tenancy magic — it is explicit in each query, and edit/delete first
re-fetch `{ id, userId }`. The only non-user-scoped model is `Setting` (global
config such as the generated VAPID keypair).

## Account deletion

`DELETE /api/auth/me` permanently deletes the signed-in account. It is
irreversible — there is no soft-delete or restore window — so it is deliberately
harder to trigger than any other action: the caller must echo the account's own
email address in the body (`deleteAccountSchema`), which the server compares
against the authenticated user's stored email. A session cookie alone is not
enough. The web entry point is Settings → Delete account, whose confirm button
stays disabled until the typed address matches.

Everything the user owns goes with it. `Session`, `Passkey`, `Reminder`,
`ReminderOccurrence`, and `PushSubscription` all carry `onDelete: Cascade` on
their `User` relation, so deleting the `User` row removes them atomically.

**`EmailCode` is the exception**: it is keyed by email address rather than
`userId` (it has to exist before any user does — it is the sign-up path), so it
has no cascade and is deleted explicitly in the same transaction. Without that,
the address would outlive the account it identified.

Google Play requires both an in-app deletion path and a publicly reachable URL
describing it; the latter is the privacy policy at `/privacy`, which is routed
ahead of the auth gate so it resolves for a signed-out visitor.

## App-store review access

Every sign-in path needs something a reviewer doesn't have: a mailbox to receive
the one-time code, a Google account, or an enrolled passkey. Google Play's "App
access" form expects credentials that just work, and demo mode can't serve —
it returns the code for *every* address, which is why `demoMode` is hard-disabled
in production (`env.DEMO_MODE && !isProduction`).

So exactly one account may sign in with a fixed code from the environment
(`apps/api/src/lib/review-access.ts`):

- `REVIEW_ACCOUNT_EMAIL` + `REVIEW_ACCOUNT_CODE` — **both** required, otherwise the
  path doesn't exist. Unset everywhere by default, including dev.
- `POST /api/auth/request-code` short-circuits for that address: nothing is issued
  or emailed, and the response is shaped like any other so the account isn't
  externally distinguishable.
- `POST /api/auth/verify-code` accepts the fixed code for that address only, and
  otherwise falls through to the normal `EmailCode` check.
- The code is compared in constant time (`timingSafeEqual`, with a length guard so
  it can't throw) and is never logged.
- `REVIEW_ACCOUNT_CODE` must be ≥12 characters — enforced by the env schema at
  boot, so a weak value fails loudly rather than quietly becoming a shared password.

`verify-code` is also IP rate-limited (20 per 15 min). That matters more here than
elsewhere: unlike an emailed code, the review code never expires, so it is the one
credential worth guessing.

**Operational rules.** Point it at a throwaway account holding demo reminders, never
a real one: a reviewer will sign in and look around.

**The path should be live only while a review is in flight.** Set a fresh code before
each submission, and **clear both vars once the review concludes** rather than
rotating to another long-lived value. The code never expires and its value is typed
into a Play Console form rather than held in a secret store, so between reviews it is
a standing credential on an account nobody is watching. Removing both vars disables
the path entirely with no other effect, so clearing it costs nothing and the next
submission just sets it again.
