/**
 * Shared error-shape helpers used by both the API responses and the web client.
 */
import { z } from 'zod'

/** Standard JSON error body the API returns for non-2xx responses. */
export const apiErrorSchema = z.object({
  error: z.string()
})

export type ApiErrorBody = z.infer<typeof apiErrorSchema>

/**
 * Best-effort extraction of a human-readable message from an unknown error
 * (fetch failures, thrown `Error`s, parsed API bodies).
 */
export function extractErrorMessage(value: unknown, fallback = 'Something went wrong.'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (value instanceof Error && value.message) return value.message
  if (value && typeof value === 'object') {
    const candidate = value as { error?: unknown; message?: unknown }
    if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message
  }
  return fallback
}
