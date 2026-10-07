/** Database aggregates only: no reminder content, account identities or session credentials are loaded. */
import { Prisma } from '@prisma/client'
import {
  adminStatsSchema, reminderStatLabels, occurrenceStatLabels, collaborationStatLabels,
  type AdminMetric, type AdminStats
} from '@persistent/shared'
import { prisma } from './prisma.js'

/** Fill absent groups so an empty database still produces explicit zero metrics. */
function completeMetrics(rows: AdminMetric[], labels: Record<string, string>): AdminMetric[] {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return Object.keys(labels).map((key) => byKey.get(key) ?? { key, count: 0, users: 0 })
}

/** Read one consistent snapshot. Activity includes authenticated background sync; clients are self-reported. */
export async function readAdminStats(activeDays: 7 | 30, now = new Date()): Promise<AdminStats> {
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  return prisma.$transaction(async (db) => {
    // Retain activity from logged-out/expired sessions: expiry is not inactivity.
    const [users] = await db.$queryRaw<AdminStats['users'][]>`
      WITH activity AS (
        SELECT "userId", MAX(COALESCE("lastSeenAt", "createdAt")) AS seen FROM "Session" GROUP BY "userId"
      )
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a.seen >= ${day})::int AS day,
        COUNT(*) FILTER (WHERE a.seen >= ${week})::int AS week,
        COUNT(*) FILTER (WHERE a.seen >= ${month})::int AS month,
        COUNT(*) FILTER (WHERE u."createdAt" >= ${month})::int AS "newMonth",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Reminder" r WHERE r."userId" = u.id))::int AS "withReminders"
      FROM "User" u LEFT JOIN activity a ON a."userId" = u.id
    `
    if (!users) throw new Error('User aggregate missing.')
    users.active = activeDays === 7 ? users.week : users.month
    users.inactive = users.total - users.active

    // Notes never alert. Counts describe saved configuration, including paused definitions.
    const reminders = await db.$queryRaw<AdminMetric[]>`
      SELECT m.key, COUNT(*)::int AS count, COUNT(DISTINCT r."userId")::int AS users
      FROM "Reminder" r CROSS JOIN LATERAL (VALUES
        ('total', true),
        ('reminders', r.schedule->>'kind' <> 'never'),
        ('enabled', r.schedule->>'kind' <> 'never' AND r.active),
        ('paused', r.schedule->>'kind' <> 'never' AND NOT r.active),
        ('notes', r.schedule->>'kind' = 'never'),
        ('noteChecklists', r.schedule->>'kind' = 'never' AND r.type = 'TODO'),
        ('persistent', r.schedule->>'kind' <> 'never' AND r.persistence = 'PERSISTENT'),
        ('nags', r.schedule->>'kind' <> 'never' AND r.persistence = 'PERSISTENT' AND r."soundIntervalSeconds" > 0),
        ('alarms', r.schedule->>'kind' <> 'never' AND r.persistence = 'ALARM'),
        ('alarmEscalation', r.schedule->>'kind' <> 'never' AND (r."escalateAfterMinutes" IS NOT NULL OR r."escalateAtTime" IS NOT NULL)),
        ('emailEscalation', r.schedule->>'kind' <> 'never' AND r."escalateEmail" IS NOT NULL AND r."escalateEmailAfterMinutes" IS NOT NULL)
      ) AS m(key, matches) WHERE m.matches GROUP BY m.key
    `
    const types = await db.$queryRaw<AdminMetric[]>`
      SELECT type::text AS key, COUNT(*)::int AS count, COUNT(DISTINCT "userId")::int AS users
      FROM "Reminder" GROUP BY type ORDER BY type
    `
    const schedules = await db.$queryRaw<AdminMetric[]>`
      SELECT schedule->>'kind' AS key, COUNT(*)::int AS count, COUNT(DISTINCT "userId")::int AS users
      FROM "Reminder" GROUP BY schedule->>'kind' ORDER BY key
    `
    const occurrences = await db.$queryRaw<AdminMetric[]>`
      SELECT m.key, COUNT(*)::int AS count, COUNT(DISTINCT o."userId")::int AS users
      FROM "ReminderOccurrence" o CROSS JOIN LATERAL (VALUES
        ('waiting', o.status IN ('FIRED', 'ESCALATED') AND o."acknowledgedAt" IS NULL),
        ('snoozed', o.status = 'SNOOZED' AND o."acknowledgedAt" IS NULL),
        ('notifiedMonth', o."firedAt" >= ${month}),
        ('completedMonth', o."acknowledgedAt" >= ${month}),
        ('escalatedMonth', o."escalatedAt" >= ${month}),
        ('emailedMonth', o."escalationEmailedAt" >= ${month})
      ) AS m(key, matches) WHERE m.matches GROUP BY m.key
    `
    const collaboration = await db.$queryRaw<AdminMetric[]>`
      SELECT 'shares' AS key, COUNT(*)::int AS count, COUNT(DISTINCT r."userId")::int AS users
        FROM "ReminderShare" s JOIN "Reminder" r ON r.id = s."reminderId"
      UNION ALL SELECT 'invitations', COUNT(*)::int, COUNT(DISTINCT r."userId")::int
        FROM "ReminderInvitation" i JOIN "Reminder" r ON r.id = i."reminderId"
      UNION ALL SELECT 'assignments', COUNT(*)::int, COUNT(DISTINCT "creatorId")::int FROM "ReminderAssignment"
      UNION ALL SELECT 'pendingAssignments', COUNT(*)::int, COUNT(DISTINCT "creatorId")::int
        FROM "ReminderAssignment" WHERE state = 'PENDING'
    `
    // Distinct users per group, not installs/devices. A user can appear in several groups.
    const clients = await db.$queryRaw<AdminStats['clients']>`
      SELECT "clientApp" AS app, "clientPlatform" AS platform, "webVersion", "nativeVersion",
        COUNT(DISTINCT "userId")::int AS users, COUNT(*)::int AS sessions
      FROM "Session" WHERE COALESCE("lastSeenAt", "createdAt") >= ${month}
      GROUP BY "clientApp", "clientPlatform", "webVersion", "nativeVersion"
      ORDER BY users DESC, app, platform, "webVersion", "nativeVersion"
    `
    return adminStatsSchema.parse({
      generatedAt: now.toISOString(), activeDays, users,
      reminders: completeMetrics(reminders, reminderStatLabels), types, schedules,
      occurrences: completeMetrics(occurrences, occurrenceStatLabels),
      collaboration: completeMetrics(collaboration, collaborationStatLabels), clients
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
