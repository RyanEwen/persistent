/**
 * Tiny bridge so non-React code (nativeSync) can drive React Router navigation.
 * The app registers a handler (wired to useNavigate); callers request a path and
 * the latest request is replayed if no handler is registered yet (e.g. a
 * notification tap that resolves before the router mounts).
 */
type NavHandler = (path: string) => void

let handler: NavHandler | null = null
let pending: string | null = null

export function registerNavHandler(fn: NavHandler): () => void {
  handler = fn
  if (pending) {
    const path = pending
    pending = null
    fn(path)
  }
  return () => {
    if (handler === fn) handler = null
  }
}

export function navigateApp(path: string): void {
  if (handler) handler(path)
  else pending = path
}
