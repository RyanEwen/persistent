/**
 * Tiny bridge so non-React code (e.g. the TanStack Query client) can raise a
 * toast. The ToastProvider registers its handler on mount; `notify` is a no-op
 * until then.
 */
type ToastColor = 'success' | 'danger' | 'neutral'
type ShowToast = (message: string, color?: ToastColor) => void

let handler: ShowToast | null = null

export function setToastHandler(fn: ShowToast | null): void {
  handler = fn
}

export function notify(message: string, color: ToastColor = 'neutral'): void {
  handler?.(message, color)
}
