/**
 * Android Back that behaves like an app, not like a browser.
 *
 * Capacitor's default Back walks the WebView's *history*, which is why the app
 * felt wrong: a web history records every hop you made (list -> reminder -> edit
 * -> back to reminder -> list -> settings...), so Back retraced that whole trail
 * and could take many presses to leave — something no native app does.
 *
 * Android's model is a *hierarchy*, not a trail: Back goes up one level, and the
 * number of presses to leave a screen is a property of where you are, not of how
 * you got there. That's what this implements (the standard bottom-nav behaviour):
 *
 * - A dialog open? It swallows Back and closes. Nothing else happens.
 * - A screen claiming Back (the editor, asking about unsaved changes)? It decides.
 * - On a detail/editor screen? Go up to its parent — the list — regardless of the
 *   route you arrived from (a notification tap lands deep with no trail behind it,
 *   and Back must still go somewhere sensible).
 * - On a bottom-nav tab other than the first? Go to the first tab.
 * - On the first tab? Leave the app.
 *
 * Registering a `backButton` listener suppresses Capacitor's own history-walking,
 * so this fully replaces it. The browser keeps ordinary history.
 *
 * The Windows tray app drives the same hierarchy from its title-bar back button:
 * it posts a `back` message rather than navigating itself, because which screen
 * is "up" is a web concern and two implementations would drift. `performBack` is
 * the shared answer; only what happens when Back runs out differs (Android leaves
 * the app, the flyout closes).
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { App } from '@capacitor/app'
import { isNative } from './alarmBridge.js'
import { onHostMessage, requestClose } from './desktopBridge.js'
import { hasOpenBackAwareDialog } from '../components/backAwareDialogStack.js'
import { runBackInterceptor } from './backInterceptor.js'

/** The bottom-nav destinations. The first is the one Back falls back to. */
const TAB_ROUTES = ['/', '/upcoming', '/history', '/settings']
const HOME_ROUTE = TAB_ROUTES[0]!

/** Screens reached from Settings, so Back returns there rather than to the list. */
const SETTINGS_CHILDREN = ['/help', '/privacy', '/delete-account']

/**
 * The screen one level up, or null when already at a tab root.
 *
 * Derived from the path rather than from history on purpose: arriving by
 * notification tap gives a deep screen with nothing behind it, and Back has to
 * behave the same there as when the user navigated in.
 */
export function parentRoute(pathname: string): string | null {
  if (TAB_ROUTES.includes(pathname)) return null
  if (SETTINGS_CHILDREN.includes(pathname)) return '/settings'
  // Everything else — /reminders/new, /reminders/:id, and the editor — sits
  // directly under the list.
  //
  // The editor used to go up to the reminder's detail view, which stopped being
  // true when in-app list taps started opening the editor directly: Back then
  // landed the user on a screen they had never passed through on the way in, and
  // took two presses to leave. Detail is now a notification/History landing page,
  // not a step in the main hierarchy, so the editor's parent is the list. This
  // also matches the editor's own Cancel button, which already went there.
  return HOME_ROUTE
}

/**
 * Whether a Back press found somewhere to go. `exhausted` means the user is at
 * the root with nothing above it — what each host does about that differs
 * (Android leaves the app, the Windows flyout closes), which is why this reports
 * rather than decides.
 */
export type BackResult = 'handled' | 'exhausted'

/**
 * One Back press, walking the screen hierarchy. Shared by every host that has a
 * Back affordance — Android's gesture/button and the Windows flyout's title-bar
 * button — so the two can never drift into answering Back differently.
 */
export function performBack(pathname: string, navigate: NavigateFunction): BackResult {
  // A dialog owns Back first. It tracks itself as a history entry, so popping
  // history is what closes it (see BackAwareModal).
  if (hasOpenBackAwareDialog()) {
    window.history.back()
    return 'handled'
  }
  // A screen may claim Back — the editor does, to ask before dropping edits.
  // Checked after dialogs so its own confirm dialog closes with Back normally.
  if (runBackInterceptor()) return 'handled'

  const parent = parentRoute(pathname)
  // `replace`, not push: going up must shrink the trail, never extend it —
  // otherwise Back would eventually walk forwards through screens you left.
  if (parent !== null) {
    navigate(parent, { replace: true })
    return 'handled'
  }
  if (pathname !== HOME_ROUTE) {
    navigate(HOME_ROUTE, { replace: true })
    return 'handled'
  }
  return 'exhausted'
}

export function useNativeBack(): void {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // The listener is registered once; routing state is read through a ref so a
  // navigation doesn't churn the native listener on every screen change.
  const current = useRef<{ pathname: string; navigate: NavigateFunction }>({ pathname, navigate })
  current.current = { pathname, navigate }

  // Android: Capacitor's hardware/gesture Back.
  useEffect(() => {
    if (!isNative()) return
    let handle: { remove: () => Promise<void> } | undefined
    let cancelled = false

    void App.addListener('backButton', () => {
      const { pathname: here, navigate: go } = current.current
      if (performBack(here, go) === 'exhausted') void App.exitApp()
    })
      .then((registered) => {
        if (cancelled) void registered.remove()
        else handle = registered
      })
      // Matches the native-call convention elsewhere in this folder. A failure here
      // means Back falls back to Capacitor's default rather than breaking.
      .catch(() => {})

    return () => {
      cancelled = true
      void handle?.remove()
    }
  }, [])

  // Windows host messages. `back` is the flyout's title-bar button, which posts a
  // message rather than navigating itself; exhausting the hierarchy closes the
  // flyout — the same "leave" that exitApp is on Android. `navigate` is a click on
  // a Windows toast, which lands on that reminder's detail view exactly as a
  // notification tap does on every other surface (notification-behavior.md).
  useEffect(() => {
    return onHostMessage((message) => {
      const { pathname: here, navigate: go } = current.current
      if (message.type === 'navigate') {
        if (message.path !== here) go(message.path)
        return
      }
      if (performBack(here, go) === 'exhausted') requestClose()
    })
  }, [])
}
