# Web conventions (`apps/web`)

- **Mobile-first.** Every UI change must work at phone widths first, then scale
  up. The shell is a single centered column (`components/AppLayout.tsx`).
- **Joy UI only** for components; theme in `src/theme.ts`. Don't pull in MUI
  Material or other component kits.
- **No god files.** Break components into their own files — one primary
  component per file, with its tightly-coupled subcomponents/helpers extracted
  into sibling files under a feature folder (e.g. `pages/reminder-editor/`)
  rather than growing one large file. Reusable pieces go in `components/`. The
  exception is when splitting genuinely hurts clarity — a handful of tiny
  presentational helpers used only by one component can stay inline. Prefer the
  split when a file accretes multiple distinct sections, repeated blocks, or
  more than a couple hundred lines.
- **Data:** load through `apiFetch` (`lib/apiClient.ts`) wrapped in TanStack
  Query hooks under `src/data/`. Never call bare `fetch` for JSON and never poll
  — live updates arrive over `/ws` (`lib/wsClient.ts`) and invalidate query keys
  defined in `lib/queryClient.ts`.
- **Auth:** use the `useAuth()` hook (`auth/useAuth.tsx`). The WebSocket starts/
  stops with the session automatically.
- **Mutations** are registered as defaults in `lib/queryClient.ts`
  (`registerMutationDefaults`) keyed by `mutationKeys`; hooks in `src/data/` just
  reference the key. Defaults own the optimistic cache update + `onSettled`
  invalidation, so a mutation queued offline can be replayed after reload
  (`resumePausedMutations`). The matching WS event also invalidates, so clients
  converge. The query cache is persisted to localStorage (`lib/persistQuery.ts`)
  for offline reads.
- **Push:** the subscription flow lives in `lib/push.ts`; the service worker
  (`public/push-handler.js`) renders notifications and handles Done/Snooze/Silence
  actions + best-effort re-fire (Silence shows only on escalations). Remember the
  web is intentionally best-effort — the hard alarm is the native app.
- **Client display prefs** (time format, theme, chosen sounds, and the
  device-default notification-shade prominence) live in `settings/useSettings.tsx`
  (localStorage-backed, per-device — not server-synced). Themes are defined in
  `settings/themes.ts` and applied as a background pattern + accent CSS variables
  by `components/AppLayout.tsx`. Format dates/times via `lib/datetime.ts`, never
  `toLocaleString` directly.
- **Native bridge:** `src/native/` (bundled into this app, which Capacitor loads)
  drives the on-device alarm plugin — schedules alarms from `/api/sync/occurrences`,
  re-syncs live on WS events, and exposes `pickSound`. Guard every call behind
  `isNative()`; it's a no-op on the web. Started from `useAuth` after sign-in. The
  same folder holds the GitHub update check (`useUpdate`/`UpdateCheck`/
  `UpdateSettings`), which installs newer APKs via the native `Update` plugin.
- **No native dialogs:** don't use `alert`/`confirm`/`prompt` (eslint enforces).
- **Dialogs are back-aware:** build modals with `components/BackAwareModal.tsx`
  (not raw Joy `Modal`) so Android/browser Back closes the top dialog and dialogs
  don't linger in history. Pages are routes (Back navigates normally).
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
