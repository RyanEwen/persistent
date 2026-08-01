/**
 * Lets one screen take Back before the app's normal up-navigation runs.
 *
 * Only the editor uses this, to ask about unsaved changes rather than silently
 * discarding them. It is a single slot, not a stack: two screens are never
 * mounted at once here, and a stack would quietly hide the bug if they were.
 *
 * Kept separate from `navTo.ts` because the direction is opposite — that one lets
 * native code drive the router, this lets the router refuse a native gesture.
 */
type BackInterceptor = () => boolean

let interceptor: BackInterceptor | null = null

/**
 * Register the intercept for as long as the screen is mounted. The callback
 * returns true if it handled Back (nothing further happens) or false to let the
 * normal hierarchy walk continue.
 */
export function setBackInterceptor(fn: BackInterceptor): () => void {
  interceptor = fn
  return () => {
    if (interceptor === fn) interceptor = null
  }
}

/** True when a screen claimed this Back press. */
export function runBackInterceptor(): boolean {
  return interceptor ? interceptor() : false
}
