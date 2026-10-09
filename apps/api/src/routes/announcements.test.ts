/** Route behavior: private unread lists, authentication, and durable idempotent dismissals. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Request, Response } from 'express'
import type { PrismaClient } from '@prisma/client'

process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
// Prisma delegates are proxies whose virtual methods Node's mock tracker cannot
// replace. Install a plain database boundary before loading the real router.
const delegate = {
  findMany: async () => [] as { announcementId: string }[],
  createMany: async () => ({ count: 0 })
}
const testGlobal = globalThis as unknown as { prisma: PrismaClient }
testGlobal.prisma = { announcementView: delegate } as unknown as PrismaClient
const { announcementsRouter } = await import('./announcements.js')

interface RouteLayer {
  route?: {
    path: string
    methods: Record<string, boolean>
    stack: { handle: (request: Request, response: Response) => Promise<void> }[]
  }
}

/** Invoke a real route handler while replacing only its database boundary. */
async function invoke(method: 'get' | 'post', path: string, userId?: string, id = 'themes-match-system') {
  const layer = (announcementsRouter.stack as RouteLayer[])
    .find((entry) => entry.route?.path === path && entry.route.methods[method])
  const handler = layer?.route?.stack[0]?.handle
  assert.ok(handler, 'The requested route must be registered')
  let body: unknown
  const headers: Record<string, string> = {}
  const response = {
    setHeader: (name: string, value: string) => { headers[name] = value },
    json: (value: unknown) => { body = value }
  } as unknown as Response
  await handler({ userId, params: { id } } as unknown as Request, response)
  return { body, headers }
}

test('anonymous readers and dismissals are rejected before database access', async (context) => {
  const read = context.mock.method(delegate, 'findMany', () => { throw new Error('Database accessed') })
  const write = context.mock.method(delegate, 'createMany', () => { throw new Error('Database accessed') })
  await assert.rejects(invoke('get', '/'), { statusCode: 401 })
  await assert.rejects(invoke('post', '/:id/viewed'), { statusCode: 401 })
  assert.equal(read.mock.callCount(), 0)
  assert.equal(write.mock.callCount(), 0)
})

test('viewed announcements disappear only for the account that dismissed them', async (context) => {
  const views = new Set<string>()
  context.mock.method(delegate, 'findMany', async ({ where }: { where: { userId: string } }) =>
    views.has(where.userId) ? [{ announcementId: 'themes-match-system' }] : []
  )
  const write = context.mock.method(delegate, 'createMany', async (input: {
    data: { userId: string; announcementId: string }[]; skipDuplicates: boolean
  }) => {
    assert.equal(input.skipDuplicates, true)
    assert.equal(input.data[0]!.announcementId, 'themes-match-system')
    const userId = input.data[0]!.userId
    const count = views.has(userId) ? 0 : 1
    views.add(userId)
    return { count }
  })
  assert.deepEqual((await invoke('post', '/:id/viewed', 'alice')).body, { ok: true })
  assert.deepEqual((await invoke('post', '/:id/viewed', 'alice')).body, { ok: true })
  assert.equal(write.mock.callCount(), 2)
  assert.deepEqual((await invoke('get', '/', 'alice')).body, { announcements: [] })
  const bob = await invoke('get', '/', 'bob')
  assert.equal((bob.body as { announcements: unknown[] }).announcements.length, 1)
  assert.equal(bob.headers['Cache-Control'], 'no-store')
})

test('unknown or malformed announcement ids cannot create viewed records', async (context) => {
  const write = context.mock.method(delegate, 'createMany', () => { throw new Error('Database accessed') })
  for (const id of ['unknown-announcement', '../bad', '']) {
    await assert.rejects(invoke('post', '/:id/viewed', 'alice', id), { statusCode: 404 })
  }
  assert.equal(write.mock.callCount(), 0)
})
