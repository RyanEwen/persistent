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
 * so this fully replaces it. Native only — the browser keeps ordinary history.
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { App } from '@capacitor/app'
import { isNative } from './alarmBridge.js'
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

export function useNativeBack(): void {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // The listener is registered once; routing state is read through a ref so a
  // navigation doesn't churn the native listener on every screen change.
  const current = useRef<{ pathname: string; navigate: NavigateFunction }>({ pathname, navigate })
  current.current = { pathname, navigate }

  useEffect(() => {
    if (!isNative()) return
    let handle: { remove: () => Promise<void> } | undefined
    let cancelled = false

    void App.addListener('backButton', () => {
      // A dialog owns Back first. It tracks itself as a history entry, so popping
      // history is what closes it (see BackAwareModal).
      if (hasOpenBackAwareDialog()) {
        window.history.back()
        return
      }
      // A screen may claim Back — the editor does, to ask before dropping edits.
      // Checked after dialogs so its own confirm dialog closes with Back normally.
      if (runBackInterceptor()) return
      const { pathname: here, navigate: go } = current.current
      const parent = parentRoute(here)
      // `replace`, not push: going up must shrink the trail, never extend it —
      // otherwise Back would eventually walk forwards through screens you left.
      if (parent !== null) go(parent, { replace: true })
      else if (here !== HOME_ROUTE) go(HOME_ROUTE, { replace: true })
      else void App.exitApp()
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
}
