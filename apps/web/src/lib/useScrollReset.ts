/**
 * Send the window back to the top when the route changes.
 *
 * The app is one scrolling document (`AppLayout` sets no inner scroll container),
 * so nothing resets it on its own: switching from a scrolled-down History to
 * Settings left you part-way down a completely different screen.
 *
 * **POP is deliberately exempt.** Back/forward should return you to where you
 * were, and because the document never actually reloads in an SPA the scroll
 * offset is still there to return to — resetting on POP would be the one case that
 * throws it away, and would also fight the browser's own `scrollRestoration`.
 */
import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export function useScrollReset(): void {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (navigationType === 'POP') return
    window.scrollTo(0, 0)
  }, [pathname, navigationType])
}
