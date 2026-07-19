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
from `apps/web/public`) listing the app package + release-cert SHA-256, which
authorizes the app for the RP. Update that fingerprint if the signing key
changes.

## Sign in with Google

Optional third method (enabled when `GOOGLE_CLIENT_ID` is set; the client reads
`GET /api/auth/config` to decide whether to show it). The client obtains a Google
**ID token** — web via Google Identity Services, native via the Credential Manager
Google ID option (`GoogleAuthPlugin`) — and posts it to `POST /api/auth/google`,
which verifies it (`google-auth-library`, audience = `GOOGLE_CLIENT_ID`), requires
a verified email, upserts the user **by email** (so it links to the same account
as the email-code / passkey methods), and starts the usual session.

Native requires an Android OAuth client registered for the package + signing
SHA-1; the web client id is passed as the `serverClientId`. Like passkeys, the
SHA-1 changes under Play App Signing.

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
