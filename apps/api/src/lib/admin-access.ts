/** Database-owned admin grants, checked afresh before any aggregate cross-user read. */
import type { Request } from 'express'
import { prisma } from './prisma.js'
import { requireUserId } from './auth-middleware.js'
import { forbidden } from './http-error.js'

/** Only initial verified account creation bootstraps Ryan; subsequent logins preserve database revocation. */
export function initialAdminGrant(verifiedEmail: string): boolean {
  return verifiedEmail.trim().toLowerCase() === 'ryan.ewen@gmail.com'
}

/** Reject anonymous and ordinary accounts before querying cross-user statistics. */
export async function requireAdmin(request: Request): Promise<string> {
  const userId = requireUserId(request)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } })
  if (!user?.isAdmin) throw forbidden('Administrator access required.')
  return userId
}
