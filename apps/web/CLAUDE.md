# Web conventions (`apps/web`)

- **Mobile-first.** Every UI change must work at phone widths first, then scale
  up. The shell is a single centered column (`components/AppLayout.tsx`).
- **Only autofocus a field when filling it is the reason the screen opened.** On a
  phone the focus raises the keyboard, which covers most of the form. Creating a
  reminder qualifies — the empty title is the next thing to do; opening an existing
  one does not, since the user is usually there to read it or change something
  further down (`pages/reminder-editor/DetailsTab.tsx`, `autoFocusTitle`).
- **Joy UI only** for components; theme in `src/theme.ts`. Don't pull in MUI
  Material or other component kits.
- **The loudest control on a screen is the one that finishes work.** Done
  (`components/OccurrenceActions.tsx`, solid `success`) is the app's entire
  guarantee, so nothing that merely *creates* or navigates may outrank it —
  no solid accent fill, no larger size, no position above it. "New reminder" was
  exactly that mistake: a full-width solid `primary` bar sitting directly on top
  of the Done it competed with. It is a soft floating button now
  (`components/NewReminderFab.tsx`) — the rule is about emphasis, not position:
  that button sits in the conventional bottom-right corner and may overlap a
  card's actions at narrow widths, which is a documented trade-off rather than a
  licence to outrank Done visually.
- **One heading treatment.** Every screen and in-page section opens with
  `components/SectionHeading.tsx` (`title-md` + an optional `body-sm`
  `text.tertiary` line) — don't hand-roll a `Typography` pair. It carries **no
  margin of its own**: put it first inside a `Stack` and that `Stack`'s `spacing`
  is the single number setting the gap to the content. The tabs had drifted to
  `title-lg` on Settings/Help versus `title-md` on the lists, with the gap built
  from `mb` on the subtitle in some places and a `mt: -1` pulling it back up in
  others; keeping the spacing in the container is what stops those corrections
  reappearing. `1.5` (12px) is the app's rhythm for stacked items — list rows,
  cards and heading-to-content alike. Signed-out documents (`PrivacyPage`,
  `DeleteAccountPage`) are prose, not app screens, and keep their own convention.
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
  defined in `lib/queryClient.ts`. **History is the one paged feed**
  (`usePastOccurrences` is a `useInfiniteQuery` — read it as `data.pages.flatMap`,
  not `data.map`); it only ever grows, so it loads a page at a time behind "Show
  more". Active and upcoming are small by construction and load whole.
- **Auth:** use the `useAuth()` hook (`auth/useAuth.tsx`). The WebSocket starts/
  stops with the session automatically. `App.tsx` renders `SignInPage` for anyone
  signed out, so a route that must work **without** a session (currently only
  `/privacy`, which Google Play fetches logged-out) has to be declared in the
  signed-out `<Routes>` above that gate as well as in the app shell below it.
- **Mutations** are registered as defaults in `lib/queryClient.ts`
  (`registerMutationDefaults`) keyed by `mutationKeys`; hooks in `src/data/` just
  reference the key. Defaults own the optimistic cache update + `onSettled`
  invalidation, so a mutation queued offline can be replayed after reload
  (`resumePausedMutations`). The matching WS event also invalidates, so clients
  converge. The query cache is persisted to localStorage (`lib/persistQuery.ts`)
  for offline reads, and **busted on every app version**: it holds DTOs shaped by
  the build that wrote them, so restoring an older release's rows into newer
  components feeds them fields that release never had. Components must survive one
  anyway — look enum-ish values up defensively (`components/ReminderIcons.tsx`),
  because a React element type that resolves to `undefined` takes down the whole
  view rather than one row.
- **Staying current:** the service worker is `registerType: 'autoUpdate'`, so a new
  build takes over and reloads on its own — but the browser only *looks* for one on
  a navigation and on its own ~24h timer. A page opened once and left running for
  days never navigates, so `lib/swUpdate.ts` asks explicitly when the page becomes
  visible and hourly while it stays visible. Don't move this back to a bare
  `registerSW()`: the Windows tray app navigates exactly once per process and
  suspends the page in between, so without it that host never updates at all.
- **Push:** the web subscription flow lives in `lib/push.ts`; the service worker
  (`public/push-handler.js`) renders notifications and handles Done/Snooze/Silence
  actions + best-effort re-fire (Silence shows only on escalations). Remember the
  web is intentionally best-effort — the hard alarm is the native app. The **native
  FCM** registration is separate: `native/nativeSync.ts` `initFcm()` registers the
  token (gated on the server's `fcmEnabled`) and resyncs on push; the native
  `FcmService` acts on pushes when the bridge is dead (see `docs/alarm-architecture.md`).
- **Client display prefs** (time format, theme, chosen sounds, and the
  device-default notification-shade prominence) live in `settings/useSettings.tsx`
  (localStorage-backed, per-device — not server-synced). They describe a *device*,
  which is what makes local right for them. The one display state that is **not**
  local is whether a checklist's ticked items are collapsed
  (`Reminder.hideCheckedItems`, `data/reminders.ts` `useSetHideCheckedItems`): it
  describes one *list*, and the whole point is that a list stays as you left it on
  your other device. Don't move a per-list view state into `useSettings`, and
  don't put a device-shaped preference on the reminder. Themes are defined in
  `settings/themes.ts` and applied as a background pattern + accent CSS variables
  by `components/AppLayout.tsx`. Format dates/times via `lib/datetime.ts`, never
  `toLocaleString` directly.
- **Native bridge:** `src/native/` (bundled into this app, which Capacitor loads)
  drives the on-device alarm plugin — schedules alarms from `/api/sync/occurrences`,
  re-syncs live on WS events, and exposes `pickSound`. Guard every call behind
  `isNative()`; it's a no-op on the web. Started from `useAuth` after sign-in. The
  same folder holds the GitHub update check (`useUpdate`/`UpdateCheck`/
  `UpdateSettings`), which installs newer APKs via the native `Update` plugin.
- **Host messages (desktop) get an explicit switch**, never a fall-through
  (`native/useNativeBack.ts`). The handler once ended in "anything else means
  Back", and Back from the root screen closes the flyout — so the first new message
  type added made the tray app close itself the instant it opened. Unknown messages
  must do nothing.
- **Anything `position: fixed` on a list screen must be portalled to `document.body`**
  (`components/NewReminderFab.tsx`). `PullToRefresh` wraps those pages and sets
  `transform: translateY(...)`, and *any* transform other than `none` makes that
  element the containing block for fixed descendants — so a floating control
  rendered in place resolves against the page-tall pull container and lands off
  screen instead of above the nav. It still computes as `position: fixed`, which is
  what makes it confusing to debug. Such a control also has to clear `BottomNav`
  **and** `env(safe-area-inset-bottom)`, and anchor to the 640px centred column
  rather than the viewport.
- **No native dialogs:** don't use `alert`/`confirm`/`prompt` (eslint enforces).
- **A new screen starts at the top.** `lib/useScrollReset.ts` (called once in
  `App.tsx`) scrolls to 0 on route change, because the app is one scrolling
  document and nothing else resets it — without it, leaving a scrolled-down
  History dropped you part-way down Settings. It exempts `POP` deliberately, so
  Back returns you to where you were rather than fighting the browser's own
  `scrollRestoration`.
- **Dialogs are back-aware:** build modals with `components/BackAwareModal.tsx`
  (not raw Joy `Modal`) so Android/browser Back closes the top dialog and dialogs
  don't linger in history. Pages are routes (Back navigates normally).
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
