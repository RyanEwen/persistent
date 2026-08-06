/**
 * Fill a dev account with reminders covering every type, schedule kind and
 * occurrence state, so the UI can be eyeballed without hand-building each case.
 *
 *   npm run db:seed            # seeds the only user, or pass --email=you@example.com
 *   npm run db:seed -- --keep  # add to what's there instead of replacing
 *
 * Occurrences are written directly rather than left to the scheduler, because the
 * interesting states (escalated, snoozed, orphaned, part-ticked) are ones the
 * scheduler only reaches after real time passes.
 *
 * DEV ONLY. By default it deletes the target user's existing reminders — and
 * nothing else: the account, passkeys and sessions are untouched, so seeding never
 * signs you out.
 */
import { PrismaClient, type OccurrenceStatus } from '@prisma/client'

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1]
const keep = args.includes('--keep')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const now = new Date()
const ago = (ms: number) => new Date(now.getTime() - ms)
const ahead = (ms: number) => new Date(now.getTime() + ms)

/** "YYYY-MM-DD" for a date offset by whole days from today. */
function isoDay(offsetDays = 0): string {
  const d = new Date(now.getTime() + offsetDays * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface SeedOccurrence {
  scheduledFor: Date
  status: OccurrenceStatus
  firedAt?: Date | null
  /** Defaults to `firedAt`; set explicitly to model a snooze revived later. */
  lastNotifiedAt?: Date | null
  acknowledgedAt?: Date | null
  snoozedUntil?: Date | null
  escalatedAt?: Date | null
  checkedItems?: string[]
}

interface Seed {
  note: string
  reminder: Record<string, unknown>
  occurrences?: SeedOccurrence[]
}

/** Checklist items need stable ids; the ticks below reference them. */
const evening = [
  { id: 'ev-1', text: 'Lock the back door' },
  { id: 'ev-2', text: 'Dishwasher on' },
  { id: 'ev-3', text: 'Set the thermostat' },
  { id: 'ev-4', text: 'Lights off' }
]
const groceries = [
  { id: 'gr-1', text: 'Milk' },
  { id: 'gr-2', text: 'Bread' },
  { id: 'gr-3', text: 'Coffee' },
  { id: 'gr-4', text: 'Eggs' }
]
// A checklist on a note. Ticked directly on the reminder (a note has no firing
// for ticks to belong to), which is the one place that state is legitimate.
const camping = [
  { id: 'cp-1', text: 'Tent + poles' },
  { id: 'cp-2', text: 'Sleeping bags' },
  { id: 'cp-3', text: 'Stove and gas' },
  { id: 'cp-4', text: 'Head torches' }
]

const seeds: Seed[] = [
  {
    note: 'unscheduled, still unconfirmed — must read "Unconfirmed", never "Due"',
    reminder: {
      title: 'Call the plumber',
      details: 'The upstairs tap is still dripping.',
      type: 'NONE',
      schedule: { kind: 'none', timesOfDay: [] },
      startDate: isoDay()
    },
    occurrences: [{ scheduledFor: ago(3 * HOUR), status: 'FIRED', firedAt: ago(3 * HOUR) }]
  },
  {
    note: 'plainly due — the ordinary warning card',
    reminder: {
      title: 'Take the bins out',
      type: 'NONE',
      schedule: { kind: 'once', timesOfDay: ['09:00'] },
      startDate: isoDay(),
      soundIntervalSeconds: 600
    },
    occurrences: [{ scheduledFor: ago(90 * MINUTE), status: 'FIRED', firedAt: ago(90 * MINUTE) }]
  },
  {
    note: 'escalated to an alarm — the only card that should shout',
    reminder: {
      title: 'Morning meds',
      type: 'MEDICATION',
      typeData: { medications: [{ name: 'Metformin', quantity: 500, unit: 'mg' }, { name: 'Ramipril', quantity: 5, unit: 'mg' }] },
      schedule: { kind: 'daily', timesOfDay: ['08:00'] },
      startDate: isoDay(-30),
      escalateAfterMinutes: 30,
      soundIntervalSeconds: 300
    },
    occurrences: [
      { scheduledFor: ago(5 * HOUR), status: 'ESCALATED', firedAt: ago(5 * HOUR), escalatedAt: ago(4 * HOUR) }
    ]
  },
  {
    note: 'checklist part-way through — 2 of 4 ticked',
    reminder: {
      title: 'Lock up for the night',
      type: 'TODO',
      typeData: { items: evening },
      schedule: { kind: 'daily', timesOfDay: ['22:00'] },
      startDate: isoDay(-14)
    },
    occurrences: [
      { scheduledFor: ago(2 * HOUR), status: 'FIRED', firedAt: ago(2 * HOUR), checkedItems: ['ev-1', 'ev-2'] }
    ]
  },
  {
    note: 'snoozed — comes back in 25 minutes',
    reminder: {
      title: 'Physio exercises',
      details: 'Shoulder set, 10 reps each.',
      type: 'NONE',
      schedule: { kind: 'daily', timesOfDay: ['17:00'] },
      startDate: isoDay(-7)
    },
    occurrences: [
      { scheduledFor: ago(45 * MINUTE), status: 'SNOOZED', firedAt: ago(45 * MINUTE), snoozedUntil: ahead(25 * MINUTE) }
    ]
  },
  {
    note: 'revived snooze — fired this morning, came back a minute ago, so it sorts first',
    reminder: {
      title: 'Chase the invoice',
      details: 'Second follow-up.',
      type: 'NONE',
      schedule: { kind: 'daily', timesOfDay: ['08:00'] },
      startDate: isoDay(-5)
    },
    occurrences: [
      {
        scheduledFor: ago(9 * HOUR),
        status: 'FIRED',
        // firedAt stays anchored to the first fire; lastNotifiedAt is the revival.
        firedAt: ago(9 * HOUR),
        lastNotifiedAt: ago(MINUTE)
      }
    ]
  },
  {
    note: 'orphaned — fired, then the reminder was pushed into next week',
    reminder: {
      title: 'Gym session',
      type: 'NONE',
      schedule: { kind: 'weekly', timesOfDay: ['07:00'], daysOfWeek: [1, 3, 5] },
      startDate: isoDay(7)
    },
    occurrences: [{ scheduledFor: ago(2 * DAY), status: 'FIRED', firedAt: ago(2 * DAY) }]
  },
  {
    note: 'monthly on the 1st, 15th and the last day',
    reminder: {
      title: 'Pay rent',
      type: 'NONE',
      schedule: { kind: 'monthly', timesOfDay: ['09:00'], daysOfMonth: [1, 15], lastDayOfMonth: true },
      startDate: isoDay(-60)
    }
  },
  {
    note: 'monthly, last day only',
    reminder: {
      title: 'Submit timesheet',
      type: 'NONE',
      schedule: { kind: 'monthly', timesOfDay: ['16:30'], lastDayOfMonth: true },
      startDate: isoDay(-90),
      escalateEmail: 'someone@example.com',
      escalateEmailAfterMinutes: 120,
      escalateEmailMessage: 'Timesheet still not submitted.'
    }
  },
  {
    note: 'weekday-only daily, skipping weekends',
    reminder: {
      title: 'Team standup',
      type: 'NONE',
      schedule: { kind: 'daily', timesOfDay: ['09:15'], skipWeekends: true },
      startDate: isoDay(-21),
      shadeProminence: 'MINIMIZED'
    }
  },
  {
    note: 'every N days',
    reminder: {
      title: 'Water the plants',
      type: 'NONE',
      schedule: { kind: 'interval', timesOfDay: ['18:00'], everyNDays: 3 },
      startDate: isoDay(-9)
    }
  },
  {
    note: 'custom weekdays',
    reminder: {
      title: 'Bin collection',
      type: 'NONE',
      schedule: { kind: 'custom', timesOfDay: ['06:45'], daysOfWeek: [2, 5] },
      startDate: isoDay(-30)
    }
  },
  {
    note: 'a hard alarm, several times a day',
    reminder: {
      title: 'Insulin',
      type: 'MEDICATION',
      typeData: { medications: [{ name: 'Insulin', quantity: 10, unit: 'units' }] },
      schedule: { kind: 'daily', timesOfDay: ['07:30', '12:30', '18:30'] },
      startDate: isoDay(-45),
      persistence: 'ALARM'
    }
  },
  {
    note: 'paused — should sink to the bottom and show no next fire',
    reminder: {
      title: 'Weekend project',
      type: 'NONE',
      schedule: { kind: 'weekly', timesOfDay: ['10:00'], daysOfWeek: [6] },
      startDate: isoDay(-60),
      active: false
    }
  },
  {
    note: 'a note — never fires, so it sits in Notes on Current, never as a card',
    reminder: {
      title: 'Wifi password',
      details: 'Guest network: hunter2\nRouter admin is on the sticker underneath.',
      type: 'NONE',
      schedule: { kind: 'never', timesOfDay: [] },
      startDate: isoDay()
    }
  },
  {
    note: 'a note holding a checklist — ticked on the reminder, and left collapsed',
    reminder: {
      title: 'Camping kit',
      type: 'TODO',
      typeData: { items: camping },
      schedule: { kind: 'never', timesOfDay: [] },
      startDate: isoDay(-2),
      // A note has no occurrence, so its ticks live here. Nothing else in this
      // file sets `checkedItems` on a Reminder, and nothing else should.
      checkedItems: ['cp-1', 'cp-3'],
      // The one seed covering the stored "Hide checked" view: this list opens
      // showing only the two items still outstanding.
      hideCheckedItems: true
    }
  },
  {
    note: 'a checklist not yet due, so the detail view shows it read-only',
    reminder: {
      title: 'Grocery run',
      type: 'TODO',
      typeData: { items: groceries },
      schedule: { kind: 'weekly', timesOfDay: ['11:00'], daysOfWeek: [0] },
      startDate: isoDay(-30)
    }
  },
  {
    note: 'history — done, including a checklist finished only part-way',
    reminder: {
      title: 'Evening walk',
      type: 'NONE',
      schedule: { kind: 'daily', timesOfDay: ['19:00'] },
      startDate: isoDay(-30)
    },
    occurrences: [
      { scheduledFor: ago(DAY), status: 'ACKNOWLEDGED', firedAt: ago(DAY), acknowledgedAt: ago(DAY - HOUR) },
      { scheduledFor: ago(2 * DAY), status: 'ACKNOWLEDGED', firedAt: ago(2 * DAY), acknowledgedAt: ago(2 * DAY - HOUR) }
    ]
  },
  {
    note: 'history — a checklist confirmed with items left unticked',
    reminder: {
      title: 'Trip packing',
      type: 'TODO',
      typeData: { items: groceries.map((g, i) => ({ id: `pk-${i}`, text: ['Passport', 'Charger', 'Tickets', 'Headphones'][i]! })) },
      schedule: { kind: 'once', timesOfDay: ['08:00'] },
      startDate: isoDay(-3)
    },
    occurrences: [
      {
        scheduledFor: ago(3 * DAY),
        status: 'ACKNOWLEDGED',
        firedAt: ago(3 * DAY),
        acknowledgedAt: ago(3 * DAY - 2 * HOUR),
        checkedItems: ['pk-0', 'pk-2']
      }
    ]
  }
]

async function main(): Promise<void> {
  const user = emailArg
    ? await prisma.user.findUnique({ where: { email: emailArg } })
    : await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) {
    throw new Error(emailArg ? `No user with email ${emailArg}.` : 'No users in this database — sign in first.')
  }

  if (!keep) {
    // Scoped to this user's reminders only (occurrences cascade). The account,
    // its passkeys and its sessions are deliberately left alone.
    const { count } = await prisma.reminder.deleteMany({ where: { userId: user.id } })
    console.log(`Removed ${count} existing reminder(s) for ${user.email}.`)
  }

  for (const seed of seeds) {
    const reminder = await prisma.reminder.create({
      data: { ...(seed.reminder as never), userId: user.id }
    })
    for (const occurrence of seed.occurrences ?? []) {
      await prisma.reminderOccurrence.create({
        data: {
          reminderId: reminder.id,
          userId: user.id,
          scheduledFor: occurrence.scheduledFor,
          status: occurrence.status,
          firedAt: occurrence.firedAt ?? null,
          lastNotifiedAt: occurrence.lastNotifiedAt ?? occurrence.firedAt ?? null,
          acknowledgedAt: occurrence.acknowledgedAt ?? null,
          snoozedUntil: occurrence.snoozedUntil ?? null,
          escalatedAt: occurrence.escalatedAt ?? null,
          checkedItems: occurrence.checkedItems ?? []
        }
      })
    }
    console.log(`  + ${reminder.title.padEnd(24)} ${seed.note}`)
  }

  console.log(`\nSeeded ${seeds.length} reminders for ${user.email}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
