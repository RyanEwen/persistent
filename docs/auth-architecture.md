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
  (hostname = RP ID). The login UI offers passkey first, with email as fallback.

Note: passkeys work in browsers/PWA. The Capacitor WebView would need Credential
Manager + assetlinks wiring to use them natively; until then the native app uses
the email code (the passkey button falls back gracefully).

## Sessions

Cookie-backed (`lib/auth-session.ts`). A random secret lives only in the
`persistent_auth` cookie (HttpOnly, SameSite=Lax, Secure on HTTPS); the database
stores its SHA-256 hash. Sessions idle-refresh on a **sliding 7-day** window:
every authenticated request (in-app action, or a notification ack/snooze/sync)
extends expiry to now + 7 days (throttled to ~5 min); a week idle signs out. The
`/ws` upgrade authenticates with the same cookie.

`attachUser` middleware resolves the cookie into `request.userId` for every
request; `requireUser` rejects anonymous callers; `requireUserId(request)`
returns the id inside handlers.

## Data isolation

The whole boundary is: **every domain query filters by `userId`.** There is no
row-level tenancy magic — it is explicit in each query, and edit/delete first
re-fetch `{ id, userId }`. The only non-user-scoped model is `Setting` (global
config such as the generated VAPID keypair).
