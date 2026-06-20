# Web conventions (`apps/web`)

- **Mobile-first.** Every UI change must work at phone widths first, then scale
  up. The shell is a single centered column (`components/AppLayout.tsx`).
- **Joy UI only** for components; theme in `src/theme.ts`. Don't pull in MUI
  Material or other component kits.
- **Data:** load through `apiFetch` (`lib/apiClient.ts`) wrapped in TanStack
  Query hooks under `src/data/`. Never call bare `fetch` for JSON and never poll
  — live updates arrive over `/ws` (`lib/wsClient.ts`) and invalidate query keys
  defined in `lib/queryClient.ts`.
- **Auth:** use the `useAuth()` hook (`auth/useAuth.tsx`). The WebSocket starts/
  stops with the session automatically.
- **Mutations** invalidate their query keys in `onSuccess`; the matching WS event
  also invalidates, so two clients converge.
- **Push:** the subscription flow lives in `lib/push.ts`; the service worker
  (`public/push-handler.js`) renders notifications and handles Done/Snooze
  actions + best-effort re-fire. Remember the web is intentionally best-effort —
  the hard alarm is the native app.
- **No native dialogs:** don't use `alert`/`confirm`/`prompt` (eslint enforces).
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
