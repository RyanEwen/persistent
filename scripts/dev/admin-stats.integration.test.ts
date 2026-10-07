/** Opt-in PostgreSQL/HTTP regressions. Use a migrated disposable database ending in _admin_test only. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'

const testUrl = process.env.ADMIN_TEST_DATABASE_URL

test('administrator aggregates, role revocation and session reporting against PostgreSQL', { skip: !testUrl }, async () => {
  assert.ok(testUrl)
  assert.match(new URL(testUrl).pathname, /_admin_test$/)
  process.env.DATABASE_URL = testUrl
  process.env.DEMO_MODE = 'true'
  const { prisma } = await import('../../apps/api/src/lib/prisma.js')
  const { createApp } = await import('../../apps/api/src/app.js')
  const { createSession } = await import('../../apps/api/src/lib/auth-session.js')
  const { readAdminStats } = await import('../../apps/api/src/lib/admin-stats.js')
  const server = createApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`

  /** Keep this test self-contained and refuse to wipe anything except its expressly designated database. */
  async function clearFixtures(): Promise<void> {
    await prisma.user.deleteMany()
    await prisma.emailCode.deleteMany()
  }
  /** Exercise real Express routing and session authentication, not a manually attached user id. */
  async function request(path: string, cookie?: string, body?: unknown): Promise<Response> {
    return fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  }
  try {
    await clearFixtures()
    assert.equal((await readAdminStats(30)).users.total, 0)
    assert.ok((await readAdminStats(30)).reminders.every((metric) => metric.count === 0))
    assert.equal((await request('/api/admin/stats')).status, 401)
    assert.equal((await request('/api/client-usage', undefined, {})).status, 401)

    // Verified creation bootstraps Ryan, then the database can revoke him without a login restoring it.
    const codeResponse = await request('/api/auth/request-code', undefined, { email: 'ryan.ewen@gmail.com' })
    const code = await codeResponse.json() as { previewCode: string }
    const login = await request('/api/auth/verify-code', undefined, { email: 'ryan.ewen@gmail.com', code: code.previewCode })
    assert.equal(login.status, 200)
    const profile = await login.json() as { user: { id: string; isAdmin: boolean } }
    assert.equal(profile.user.isAdmin, true)
    const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!
    const now = new Date()
    const ago = (days: number) => new Date(now.getTime() - days * 86400_000)
    const ordinary = await prisma.user.create({ data: { email: 'ordinary@example.com', createdAt: ago(90) } })
    const monthUser = await prisma.user.create({ data: { email: 'month@example.com', createdAt: ago(90) } })
    const inactive = await prisma.user.create({ data: { email: 'inactive@example.com', createdAt: ago(90) } })
    const ordinarySession = await createSession(ordinary.id)
    const ordinaryCookie = `persistent_auth=${ordinarySession.secret}`
    await prisma.session.create({ data: { userId: monthUser.id, secretHash: 'expired-but-active', lastSeenAt: ago(20), createdAt: ago(90), expiresAt: ago(19), revokedAt: ago(19) } })
    await prisma.session.create({ data: { userId: inactive.id, secretHash: 'inactive', lastSeenAt: ago(40), createdAt: ago(90), expiresAt: ago(39) } })
    assert.equal((await request('/api/admin/stats', ordinaryCookie)).status, 403)
    assert.equal((await fetch(`${origin}/api/admin/stats`, {
      headers: { cookie: ordinaryCookie, 'x-admin': 'true', 'x-user-id': profile.user.id }
    })).status, 403, 'caller-supplied role and account headers cannot elevate a session')
    const ordinaryCode = await (await request('/api/auth/request-code', undefined, { email: ordinary.email })).json() as { previewCode: string }
    const injectedLogin = await request('/api/auth/verify-code', undefined, {
      email: ordinary.email, code: ordinaryCode.previewCode, isAdmin: true
    })
    assert.equal(injectedLogin.status, 200)
    assert.equal(((await injectedLogin.json()) as typeof profile).user.isAdmin, false,
      'a verified public login cannot accept a caller-supplied admin role')
    assert.equal((await request('/api/admin/stats?activeDays=2', adminCookie)).status, 400)
    assert.equal((await request('/api/admin/stats?activeDays=30&activeDays=7', adminCookie)).status, 400)
    assert.equal((await request('/api/admin/stats', `${adminCookie}tampered`)).status, 401)

    const base = { userId: ordinary.id, title: 'Secret reminder title', startDate: '2026-01-01', schedule: { kind: 'daily', timesOfDay: ['09:00'] } }
    const nag = await prisma.reminder.create({ data: { ...base, soundIntervalSeconds: 60, escalateAfterMinutes: 10 } })
    await prisma.reminder.create({ data: { ...base, persistence: 'ALARM', active: false, soundIntervalSeconds: 60 } })
    await prisma.reminder.create({ data: { ...base, schedule: { kind: 'never' }, type: 'TODO', persistence: 'ALARM', soundIntervalSeconds: 60 } })
    await prisma.reminder.create({ data: { ...base, userId: monthUser.id, schedule: { kind: 'never' } } })
    await prisma.reminderOccurrence.create({ data: { userId: ordinary.id, reminderId: nag.id, scheduledFor: ago(1), firedAt: ago(1), status: 'ACKNOWLEDGED', acknowledgedAt: now } })
    await prisma.reminderOccurrence.create({ data: { userId: ordinary.id, reminderId: nag.id, scheduledFor: now, firedAt: now, status: 'FIRED', escalatedAt: now } })
    await prisma.reminderOccurrence.create({ data: { userId: ordinary.id, reminderId: nag.id, scheduledFor: ago(2), firedAt: ago(2), status: 'SNOOZED', snoozedUntil: new Date(now.getTime() + 3600_000) } })
    await prisma.reminderShare.create({ data: { reminderId: nag.id, recipientId: monthUser.id } })

    const snapshot = await readAdminStats(30, now)
    assert.deepEqual(snapshot.users, { total: 4, day: 2, week: 2, month: 3, active: 3, inactive: 1, newMonth: 1, withReminders: 2 })
    assert.equal((await readAdminStats(7, now)).users.inactive, 2)
    const metric = (key: string) => snapshot.reminders.find((entry) => entry.key === key)!
    assert.deepEqual(metric('notes'), { key: 'notes', count: 2, users: 2 })
    assert.equal(metric('nags').count, 1, 'notes and alarms must not inflate nag adoption')
    assert.equal(metric('alarms').count, 1, 'notes must not inflate alarm adoption')
    assert.equal(metric('enabled').count, 1)
    assert.equal(metric('paused').count, 1)
    assert.equal(snapshot.occurrences.find((entry) => entry.key === 'waiting')?.count, 1)
    assert.equal(snapshot.occurrences.find((entry) => entry.key === 'snoozed')?.count, 1)
    assert.equal(snapshot.occurrences.find((entry) => entry.key === 'completedMonth')?.count, 1)
    assert.equal(snapshot.collaboration.find((entry) => entry.key === 'shares')?.count, 1)
    assert.doesNotMatch(JSON.stringify(snapshot), /Secret reminder title|@example.com|secretHash|persistent_auth/)

    const report = { app: 'android', platform: 'android', webVersion: '0.1.0', nativeVersion: '1.2.3' }
    assert.equal((await request('/api/client-usage', ordinaryCookie, { ...report, isAdmin: true })).status, 400)
    assert.equal((await request('/api/client-usage', ordinaryCookie, report)).status, 200)
    const secondSession = await createSession(ordinary.id)
    assert.equal((await request('/api/client-usage', `persistent_auth=${secondSession.secret}`, report)).status, 200)
    assert.equal(await prisma.session.count({ where: { userId: profile.user.id, clientApp: { not: null } } }), 0, 'another account session must remain untouched')
    const adoption = (await readAdminStats(30)).clients
    assert.equal(adoption.find((entry) => entry.app === 'android')?.users, 1)
    assert.equal(adoption.find((entry) => entry.app === 'android')?.sessions, 2, 'multiple sessions must not inflate distinct users')
    assert.equal(adoption.find((entry) => entry.app === null)?.users, 3, 'the injected ordinary login remains an unknown client until it reports')
    const adminResponse = await request('/api/admin/stats', adminCookie)
    assert.equal(adminResponse.status, 200)
    assert.equal(adminResponse.headers.get('cache-control'), 'no-store')
    await prisma.user.update({ where: { id: profile.user.id }, data: { isAdmin: false } })
    assert.equal((await request('/api/admin/stats', adminCookie)).status, 403)
    const newCode = await (await request('/api/auth/request-code', undefined, { email: 'ryan.ewen@gmail.com' })).json() as { previewCode: string }
    const relogin = await request('/api/auth/verify-code', undefined, { email: 'ryan.ewen@gmail.com', code: newCode.previewCode })
    assert.equal(((await relogin.json()) as typeof profile).user.isAdmin, false)
    await prisma.session.updateMany({ where: { userId: ordinary.id }, data: { revokedAt: new Date() } })
    assert.equal((await request('/api/client-usage', ordinaryCookie, report)).status, 401)
    await prisma.user.delete({ where: { id: ordinary.id } })
    assert.equal((await readAdminStats(30)).reminders.find((entry) => entry.key === 'total')?.count, 1)
  } finally {
    await clearFixtures()
    server.close()
    await once(server, 'close')
    await prisma.$disconnect()
  }
})
