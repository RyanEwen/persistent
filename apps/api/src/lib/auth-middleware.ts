/**
 * Auth middleware. `attachUser` resolves the session cookie into
 * `request.userId` for every request; `requireUser` rejects anonymous callers.
 * Data routes then scope every query to `requireUserId(request)`.
 */
import type { NextFunction, Request, Response } from 'express'
import { resolveUserId } from './auth-session.js'
import { unauthorized } from './http-error.js'

export async function attachUser(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    request.userId = await resolveUserId(request, response)
    next()
  } catch (error) {
    next(error)
  }
}

export function requireUser(request: Request, _response: Response, next: NextFunction): void {
  if (!request.userId) {
    next(unauthorized('Sign in to continue.'))
    return
  }
  next()
}

/** Returns the authenticated user id or throws 401. Use inside route handlers. */
export function requireUserId(request: Request): string {
  if (!request.userId) {
    throw unauthorized('Sign in to continue.')
  }
  return request.userId
}
