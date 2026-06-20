/**
 * Singleton Prisma client. Import `prisma` from here in all feature code.
 *
 * Unlike printstream there is no tenant-scoping extension: ownership is plain
 * per-user, enforced by always including `{ userId }` in `where` clauses. That
 * single rule is the data-isolation boundary — see docs/backend-conventions.md.
 */
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
