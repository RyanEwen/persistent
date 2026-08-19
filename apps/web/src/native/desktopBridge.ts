/**
 * Bridge to the Windows desktop host (`apps/desktop`), which loads this same
 * hosted bundle in a WebView2 inside a tray flyout.
 *
 * There are now three hosts for one bundle — browser, Capacitor/Android, and this
 * one — and none of them can be compiled in, so every difference is runtime
 * feature detection. Keep `isDesktopHost()` distinct from `isNative()`
 * (`alarmBridge.ts`): Capacitor is not available here, so `isNative()` is false in
 * the desktop host, and a check that conflates the two will silently do the wrong
 * thing on one of them.
 *
 * The channel is small on purpose. Host -> page carries `back` (the flyout's
 * title-bar button, which walks the app's screen hierarchy rather than browser
 * history) and `hostSettings`; page -> host carries `close` (Back ran out of
 * hierarchy) and the settings requests below. Nothing streams *reminder* state to
 * the host: it has no surface that needs it, and a second copy of "what is due"
 * would be a second source of truth that can disagree. Host settings are the
 * opposite direction and not that: the host stays the only owner of its own
 * settings file, and the page renders what it is told.
 */

interface WebView2Bridge {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2Bridge }
  }
}

/**
 * Messages the host sends us. Anything unrecognised is ignored.
 *
 * `navigate` carries an in-app path, not a URL: it comes from clicking a Windows
 * toast, and the host deliberately does not navigate the WebView itself. Doing so
 * would reload the app and throw away where the user was — the same reason `back`
 * is a message rather than `CoreWebView2.GoBack()`.
 *
 * `checkForUpdate` says the flyout was just reopened, so this page may have been
 * frozen for days (`lib/swUpdate.ts`). It is a nudge, not an instruction: the page
 * decides whether to act, exactly as it does for `back`.
 *
 * `hostSettings` is the host's own settings, which this page's Settings screen
 * shows instead of the tray app keeping a second one (`DesktopSettings.tsx`). It
 * arrives in reply to `getHostSettings`, after every write, and whenever the host
 * changes one itself.
 */
type HostMessage =
  | { type: 'back' }
  | { type: 'navigate'; path: string }
  | { type: 'checkForUpdate' }
  | { type: 'hostSettings'; settings: HostSettings }

/**
 * One flyout size the host offers. The dimensions and their labels come from the
 * host rather than being listed here, because they describe a Windows window: a
 * desktop build that changes or adds a preset should not need a web release to go
 * with it.
 */
export interface FlyoutSizeOption {
  id: string
  label: string
  width: number
  height: number
}

/**
 * One snooze duration a Windows notification can start on.
 *
 * Sent by the host rather than taken from `SNOOZE_PRESETS`, even though that is
 * where the durations come from, because Windows caps a toast's combo box at five
 * items and throws on the sixth. So the toast carries a five-item subset, and a
 * settings picker offering the app's full seven would let the user choose two that
 * the notification can never start on. It did: the shipped default of 10 minutes
 * was one of them, so the setting read "10 min" while every toast opened on
 * "5 min". The host is the one that knows its own limit, so the host decides.
 */
export interface SnoozeChoiceOption {
  minutes: number
  label: string
}

/**
 * The Windows tray app's own settings, as it reports them.
 *
 * These are per *machine* and owned by the host's settings.json, which is what
 * separates them from everything in `settings/useSettings.tsx` (per device,
 * localStorage) and from anything on the account. The page shows and writes them
 * so the product has one Settings screen instead of two, but it never stores them.
 *
 * `startAtSignIn` is what Windows reports, not what was last asked for: an enable
 * can be refused outright when the user has turned the app off in Task Manager.
 * The host keeps no copy of it at all, so it is re-read every time it is sent.
 */
export interface HostSettings {
  notifications: boolean
  snoozeMinutes: number
  snoozeChoices: SnoozeChoiceOption[]
  pinFlyout: boolean
  startAtSignIn: boolean
  flyoutSize: string
  flyoutSizes: FlyoutSizeOption[]
}

/** The writable subset: everything except the lists of what is on offer. */
export type HostSettingsPatch = Partial<Omit<HostSettings, 'flyoutSizes' | 'snoozeChoices'>>

function isFlyoutSizeOption(value: unknown): value is FlyoutSizeOption {
  if (typeof value !== 'object' || value === null) return false
  const option = value as Record<string, unknown>
  return (
    typeof option.id === 'string' &&
    typeof option.label === 'string' &&
    typeof option.width === 'number' &&
    typeof option.height === 'number'
  )
}

function isSnoozeChoiceOption(value: unknown): value is SnoozeChoiceOption {
  if (typeof value !== 'object' || value === null) return false
  const option = value as Record<string, unknown>
  return typeof option.minutes === 'number' && typeof option.label === 'string'
}

/** Keep the first of each id/minutes, so a duplicate can't collide as a React key. */
function distinctBy<T>(options: T[], key: (option: T) => string | number): T[] {
  const seen = new Set<string | number>()
  return options.filter((option) => {
    const id = key(option)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/**
 * Validate a `hostSettings` payload, returning null for anything that isn't a
 * complete one.
 *
 * All-or-nothing rather than field-by-field defaulting, because null is what makes
 * the Settings section hide itself: a control bound to a missing field would
 * silently show a value this machine isn't using, and writing it back would then
 * change a setting the user never touched. A host that hasn't sent this at all
 * lands in the same place, which is how an older desktop build stays quiet instead
 * of showing dead controls.
 */
export function parseHostSettings(value: unknown): HostSettings | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const sizes = Array.isArray(raw.flyoutSizes)
    ? distinctBy(raw.flyoutSizes.filter(isFlyoutSizeOption), (size) => size.id)
    : []
  const snoozes = Array.isArray(raw.snoozeChoices)
    ? distinctBy(raw.snoozeChoices.filter(isSnoozeChoiceOption), (choice) => choice.minutes)
    : []
  if (
    typeof raw.notifications !== 'boolean' ||
    typeof raw.snoozeMinutes !== 'number' ||
    typeof raw.pinFlyout !== 'boolean' ||
    typeof raw.startAtSignIn !== 'boolean' ||
    typeof raw.flyoutSize !== 'string' ||
    sizes.length === 0 ||
    snoozes.length === 0
  ) {
    return null
  }
  // Snapped to something on offer rather than rejected. An out-of-list value is a
  // different failure from a missing field: the payload is intelligible, and
  // hiding the whole section over it would cost the user four working controls.
  // A picker whose value matches no option renders blank, which is the one
  // outcome worth ruling out here.
  return {
    notifications: raw.notifications,
    snoozeMinutes: nearest(snoozes, raw.snoozeMinutes),
    snoozeChoices: snoozes,
    pinFlyout: raw.pinFlyout,
    startAtSignIn: raw.startAtSignIn,
    flyoutSize: sizes.some((size) => size.id === raw.flyoutSize) ? raw.flyoutSize : sizes[0]!.id,
    flyoutSizes: sizes
  }
}

/** The offered duration closest to `minutes`, mirroring `ToastNotifier.NearestOffered`. */
function nearest(choices: SnoozeChoiceOption[], minutes: number): number {
  return choices.reduce((best, choice) =>
    Math.abs(choice.minutes - minutes) < Math.abs(best.minutes - minutes) ? choice : best
  ).minutes
}

/** True when running inside the Windows tray app's WebView2. */
export function isDesktopHost(): boolean {
  return typeof window !== 'undefined' && typeof window.chrome?.webview?.postMessage === 'function'
}

/**
 * Whether *this page* can subscribe to Web Push on this host.
 *
 * False in the desktop host, for two independent reasons — either alone is fatal:
 *
 * - WebView2 refuses `Notification.requestPermission()` unless the native host
 *   handles `PermissionRequested`, so the subscription can never be granted. The
 *   Push API may still *report* as present, which is why a capability check alone
 *   (`pushSupported()`) is not enough and this exists.
 * - The WebView is suspended whenever the flyout is hidden, freezing the page and
 *   its service worker. Even a granted subscription could only ever deliver while
 *   the flyout was already open, which is precisely when a notification is
 *   pointless.
 *
 * The tray app's Windows notifications are the answer on that host, and they are
 * raised by the host process from its own connection, not from here. They are
 * turned on from this very Settings page (`DesktopSettings.tsx`), which is why
 * hiding this card costs the user nothing: the control that works on this host is
 * a few lines below it (`docs/desktop-architecture.md`).
 */
export function hostSupportsPush(): boolean {
  return !isDesktopHost()
}

/**
 * Subscribe to messages from the host. Returns an unsubscribe function; a no-op
 * on every other host.
 *
 * Every subscriber picks out the messages it cares about and ignores the rest, so
 * `back` and `navigate` are read by `useNativeBack.ts`, `checkForUpdate` by
 * `lib/swUpdate.ts`, and `hostSettings` by `useHostSettings.ts`. In each case the
 * host says what happened and the page decides what it means: the hierarchy that
 * Back walks is a web concern, and so is what a route does.
 *
 * `path` is validated here rather than trusted: it must be a root-relative,
 * single-slash path. A host message is not a privileged caller either, and letting
 * `//evil.example` or a full URL through would turn this into an open redirect
 * driven by whatever was in a notification.
 */
export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  if (!isDesktopHost()) return () => {}
  const bridge = window.chrome!.webview!
  const listener = (event: { data: unknown }) => {
    const data = event.data
    if (typeof data !== 'object' || data === null) return
    const type = (data as { type?: unknown }).type
    if (type === 'back') handler({ type: 'back' })
    if (type === 'checkForUpdate') handler({ type: 'checkForUpdate' })
    if (type === 'navigate') {
      const path = (data as { path?: unknown }).path
      if (typeof path === 'string' && /^\/[^/]/.test(path)) handler({ type: 'navigate', path })
    }
    if (type === 'hostSettings') {
      const settings = parseHostSettings((data as { settings?: unknown }).settings)
      if (settings) handler({ type: 'hostSettings', settings })
    }
  }
  bridge.addEventListener('message', listener)
  return () => bridge.removeEventListener('message', listener)
}

/** Post to the host, or do nothing anywhere else. */
function postToHost(message: unknown): void {
  if (!isDesktopHost()) return
  try {
    window.chrome!.webview!.postMessage(message)
  } catch {
    // Every caller is a request the host may simply not answer, and each one
    // already copes with silence.
  }
}

/**
 * Ask the host to close the flyout — the desktop equivalent of Android's Back
 * leaving the app, used when a Back press has nowhere left to go.
 */
export function requestClose(): void {
  // Worst case the flyout stays open; the user can click away from it.
  postToHost({ type: 'close' })
}

/**
 * Tell the host this page is listening for its messages.
 *
 * Posted once the `onHostMessage` subscription is attached, which is the only
 * moment a `navigate` can actually be acted on. The host builds the WebView at
 * startup and holds a toast click or an "Open Persistent settings" until it hears
 * this, rather than posting into a page that has not mounted and losing it.
 */
export function announcePageReady(): void {
  postToHost({ type: 'pageReady' })
}

/**
 * Ask the host for its settings. It replies with a `hostSettings` message, and a
 * host too old to know the request simply never does, which is the whole version
 * check, since the page is a hosted bundle that updates on its own while the .exe
 * may be an older portable build or a pending Store update.
 */
export function requestHostSettings(): void {
  postToHost({ type: 'getHostSettings' })
}

/**
 * Change one or more host settings. The host validates, applies what it can, and
 * posts back the settings it actually holds, so a refused change corrects itself
 * rather than leaving the page showing something untrue.
 */
export function writeHostSettings(patch: HostSettingsPatch): void {
  postToHost({ type: 'setHostSettings', settings: patch })
}

/**
 * Open the host's own settings window, which keeps what cannot live in here: the
 * server address (a control for the setting that decides whether this page loads
 * is no use inside the page), the app version and update check, the log folder,
 * and the theme of that window itself, which this page cannot see.
 */
export function openHostSettingsWindow(): void {
  postToHost({ type: 'openHostSettings' })
}

