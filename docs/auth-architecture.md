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

## Sessions

Cookie-backed (`lib/auth-session.ts`). A random secret lives only in the
`persistent_auth` cookie (HttpOnly, SameSite=Lax, Secure on HTTPS); the database
stores its SHA-256 hash. Sessions idle-refresh (sliding 30-day expiry). The
`/ws` upgrade authenticates with the same cookie.

`attachUser` middleware resolves the cookie into `request.userId` for every
request; `requireUser` rejects anonymous callers; `requireUserId(request)`
returns the id inside handlers.

## Data isolation

The whole boundary is: **every domain query filters by `userId`.** There is no
row-level tenancy magic — it is explicit in each query, and edit/delete first
re-fetch `{ id, userId }`. The only non-user-scoped model is `Setting` (global
config such as the generated VAPID keypair).
