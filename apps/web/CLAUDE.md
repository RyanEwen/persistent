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
  (`public/push-handler.js`) renders notifications and handles Done/Snooze
  actions + best-effort re-fire. Remember the web is intentionally best-effort —
  the hard alarm is the native app.
- **No native dialogs:** don't use `alert`/`confirm`/`prompt` (eslint enforces).
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
