/**
 * Express request augmentation: `userId` is populated by attachUser middleware
 * from the session cookie (null when anonymous).
 */
import 'express'

declare global {
  namespace Express {
    interface Request {
      userId: string | null
    }
  }
}

export {}
