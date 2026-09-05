/**
 * A fixed sign-in code for one designated app-store review account.
 *
 * Sign-in here is passwordless — a one-time code emailed to the user, Google, or a
 * passkey. An app-store reviewer has none of those: they cannot read the mailbox,
 * and Google Play's "App access" form expects credentials that simply work. Demo
 * mode is not an option either, because it returns the code for *every* address
 * and `demoMode` is hard-disabled in production for exactly that reason.
 *
 * So one account — and only that account — may sign in with a static code from the
 * environment. Both vars must be set for the path to exist at all; unset (the
 * default, including every dev machine) and this module always returns false.
 *
 * Operational rules:
 * - Point it at a throwaway account holding demo reminders, never a real one.
 * - The path is meant to be live only while a review is actually in flight. Set a
 *   fresh code before each submission and **clear both vars once it concludes**,
 *   rather than rotating and leaving one set: this is a never-expiring shared
 *   secret whose value gets typed into a Play Console form, so between reviews it
 *   is a standing credential on an account nobody is watching. Clearing it is not
 *   a teardown of this module, which is why the vars are the switch.
 * - The code is compared in constant time and never logged.
 */
import { timingSafeEqual } from 'node:crypto'
import { env } from './env.js'

/** Constant-time string compare that doesn't leak length through early exit. */
function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on length mismatch, so compare digests of equal size.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Is the review-account path configured at all? */
export function reviewAccessEnabled(): boolean {
  return Boolean(env.REVIEW_ACCOUNT_EMAIL && env.REVIEW_ACCOUNT_CODE)
}

/** Is `email` the designated review account? (Code not checked.) */
export function isReviewAccount(email: string): boolean {
  if (!reviewAccessEnabled()) return false
  return email.trim().toLowerCase() === env.REVIEW_ACCOUNT_EMAIL!.trim().toLowerCase()
}

/** Does this email+code pair match the configured review credentials? */
export function isReviewLogin(email: string, code: string): boolean {
  if (!isReviewAccount(email)) return false
  return safeEquals(code.trim(), env.REVIEW_ACCOUNT_CODE!.trim())
}
