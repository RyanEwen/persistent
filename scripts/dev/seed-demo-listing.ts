/**
 * Fill the **store demo account** with the reminders the Play listing
 * screenshots are taken against.
 *
 *   npx tsx scripts/dev/seed-demo-listing.ts --email=ryan.ewen+persistentdemo@gmail.com
 *
 * Separate from `db:seed` (which covers every type/state for eyeballing the UI)
 * because this one has a different job: produce a small, believable account that
 * photographs well. Two rules follow from that.
 *
 * **No health data.** The listing must not read as a medical app while the
 * MEDICATION type is withheld (see `selectableReminderTypes`), and screenshots
 * are read by reviewers regardless of what the copy says. Nothing here is a drug,
 * a dose, or a symptom.
 *
 * **No screen repeats a reminder.** Two cards for one reminder is the app's
 * headline behavior (independent occurrences), but as a *picture* it reads as a
 * duplicate bug rather than a feature — two identical cards separated only by a
 * timestamp. The copy makes that claim in words instead; every screen here shows
 * distinct reminders. Keep it that way when adding to this list.
 *
 * Occurrences are written directly rather than left to the scheduler — an
 * already-fired, still-unconfirmed 8:00 a.m. is not a state you can reach by
 * waiting, and the alternative is the back-fill dance this replaces.
 *
 * `--email` is required and there is no "first user" fallback: this is pointed at
 * production to set up the demo account, and a wrong guess there would delete a
 * real person's reminders.
 */
import { PrismaClient, type OccurrenceStatus } from '@prisma/client'
import { DateTime } from 'luxon'

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1]
const keep = args.includes('--keep')

/**
 * The demo account's zone. It must match the *phone's* zone, not just be
 * plausible: the server materializes firings in the user's zone while the app
 * renders them in the device's, so a mismatch shows 8:00 a.m. as 3:00 a.m. in
 * the screenshot. The script sets it rather than assuming it.
 */
const ZONE = 'America/Toronto'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Local wall-clock time on `day`, as the instant it actually happened. */
function at(day: DateTime, hhmm: string): Date {
  const [hour, minute] = hhmm.split(':').map(Number)
  return day.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate()
}

const now = DateTime.now().setZone(ZONE)

/**
 * The most recent day whose firing times have all passed, so every "Due" card
 * reads "Today". Run after 6:30 p.m. local (the latest seeded firing) or the
 * cards fall back to yesterday and say so.
 */
const LATEST_FIRING_HOUR = 18.5
const dueDay = now.hour + now.minute / 60 >= LATEST_FIRING_HOUR ? now.startOf('day') : now.minus({ days: 1 }).startOf('day')
const dueIsToday = dueDay.hasSame(now, 'day')

const day = (offset: number) => now.plus({ days: offset }).startOf('day')
const isoDay = (offset = 0) => day(offset).toFormat('yyyy-MM-dd')

interface SeedOccurrence {
  scheduledFor: Date
  status: OccurrenceStatus
  firedAt?: Date | null
  acknowledgedAt?: Date | null
  checkedItems?: string[]
}

interface Seed {
  note: string
  reminder: Record<string, unknown>
  occurrences?: SeedOccurrence[]
}

const groceries = [
  { id: 'gr-1', text: 'Dog food' },
  { id: 'gr-2', text: 'Coffee' },
  { id: 'gr-3', text: 'Bread' },
  { id: 'gr-4', text: 'Dish soap' }
]
const trip = [
  { id: 'tr-1', text: 'Passports' },
  { id: 'tr-2', text: 'Chargers' },
  { id: 'tr-3', text: 'Hold the mail' }
]

const seeds: Seed[] = [
  {
    note: 'due — the hero; 3x daily is what a "must not miss" routine looks like',
    reminder: {
      title: 'Feed the puppy',
      details: 'Half a cup of kibble, and fresh water.',
      type: 'NONE',
      schedule: { kind: 'daily', timesOfDay: ['08:00', '14:00', '20:00'], skipWeekends: false },
      persistence: 'PERSISTENT',
      // No escalation on anything with a live firing: the sweep would flip it to
      // ESCALATED within a minute and the card would read "Escalated", not "Due".
      startDate: isoDay(-6)
    },
    occurrences: [
      { scheduledFor: at(dueDay, '14:00'), status: 'FIRED', firedAt: at(dueDay, '14:00') },
      {
        scheduledFor: at(dueDay, '08:00'),
        status: 'ACKNOWLEDGED',
        firedAt: at(dueDay, '08:00'),
        acknowledgedAt: new Date(at(dueDay, '08:00').getTime() + 6 * MINUTE)
      }
    ]
  },
  {
    note: 'due — second distinct card on Current',
    reminder: {
      title: 'Water the plants',
      details: 'Back bed first, then the tomatoes.',
      type: 'NONE',
      schedule: { kind: 'interval', timesOfDay: ['09:00'], everyNDays: 3, skipWeekends: false },
      persistence: 'PERSISTENT',
      startDate: isoDay(-6)
    },
    occurrences: [{ scheduledFor: at(dueDay, '09:00'), status: 'FIRED', firedAt: at(dueDay, '09:00') }]
  },
  {
    note: 'due — third distinct card, and the reminder the alarm shot uses',
    reminder: {
      title: 'Take the bins out',
      details: 'Blue box this week, not the green one.',
      type: 'NONE',
      schedule: { kind: 'weekly', timesOfDay: ['18:30'], daysOfWeek: [1] },
      // PERSISTENT on purpose: seeded as ALARM it would ring the moment the phone
      // syncs. The full-screen alarm shot flips this reminder over deliberately.
      persistence: 'PERSISTENT',
      startDate: isoDay(-21)
    },
    occurrences: [{ scheduledFor: at(dueDay, '18:30'), status: 'FIRED', firedAt: at(dueDay, '18:30') }]
  },
  {
    note: 'escalation configured, nothing live — the Escalation tab shot opens this',
    reminder: {
      title: 'Submit the timesheet',
      details: 'Before payroll closes.',
      type: 'NONE',
      schedule: { kind: 'weekly', timesOfDay: ['16:00'], daysOfWeek: [5] },
      persistence: 'PERSISTENT',
      escalateAfterMinutes: 30,
      startDate: isoDay(-28)
    },
    occurrences: [
      { scheduledFor: at(day(4), '16:00'), status: 'PENDING' },
      {
        scheduledFor: at(day(-3), '16:00'),
        status: 'ACKNOWLEDGED',
        firedAt: at(day(-3), '16:00'),
        acknowledgedAt: new Date(at(day(-3), '16:00').getTime() + 21 * MINUTE)
      }
    ]
  },
  {
    note: 'checklist, not yet due — shows the Checklist type the copy still sells',
    reminder: {
      title: 'Grocery run',
      type: 'TODO',
      typeData: { items: groceries },
      schedule: { kind: 'once', timesOfDay: ['17:30'] },
      startDate: isoDay(1)
    },
    occurrences: [{ scheduledFor: at(day(1), '17:30'), status: 'PENDING' }]
  },
  {
    note: 'a note — sits under Notes on Current, never fires',
    reminder: {
      title: 'Trip packing',
      type: 'TODO',
      typeData: { items: trip },
      schedule: { kind: 'never', timesOfDay: [] },
      checkedItems: ['tr-1'],
      startDate: isoDay()
    }
  },
  {
    note: 'monthly — a distinct History row and a distant Upcoming entry',
    reminder: {
      title: 'Change the furnace filter',
      details: 'Sizes are on the shelf above the washer.',
      type: 'NONE',
      schedule: { kind: 'monthly', timesOfDay: ['10:00'], daysOfMonth: [1], lastDayOfMonth: false },
      persistence: 'PERSISTENT',
      startDate: isoDay(-40)
    },
    occurrences: [
      {
        scheduledFor: at(day(-2), '10:00'),
        status: 'ACKNOWLEDGED',
        firedAt: at(day(-2), '10:00'),
        acknowledgedAt: new Date(at(day(-2), '10:00').getTime() + 2 * HOUR)
      }
    ]
  }
]

async function main(): Promise<void> {
  if (!emailArg) {
    throw new Error(
      'Pass --email=<demo account>. There is no default: this script is pointed at\n' +
        'production to set up the store demo account, and it replaces that user\'s reminders.'
    )
  }
  const user = await prisma.user.findUnique({ where: { email: emailArg } })
  if (!user) throw new Error(`No user with email ${emailArg}.`)

  console.log(`Target: ${user.email} (${user.id})`)
  if (user.timeZone !== ZONE) {
    await prisma.user.update({ where: { id: user.id }, data: { timeZone: ZONE } })
    console.log(`Time zone: ${user.timeZone} -> ${ZONE} (must match the phone, or the times render shifted)`)
  }

  if (!keep) {
    const { count } = await prisma.reminder.deleteMany({ where: { userId: user.id } })
    console.log(`Removed ${count} existing reminder(s). Account, passkeys and sessions untouched.`)
  }

  for (const seed of seeds) {
    const reminder = await prisma.reminder.create({ data: { ...(seed.reminder as never), userId: user.id } })
    for (const occurrence of seed.occurrences ?? []) {
      await prisma.reminderOccurrence.create({
        data: {
          reminderId: reminder.id,
          userId: user.id,
          scheduledFor: occurrence.scheduledFor,
          status: occurrence.status,
          firedAt: occurrence.firedAt ?? null,
          lastNotifiedAt: occurrence.firedAt ?? null,
          acknowledgedAt: occurrence.acknowledgedAt ?? null,
          checkedItems: occurrence.checkedItems ?? []
        }
      })
    }
    console.log(`  + ${reminder.title.padEnd(26)} ${seed.note}`)
  }

  console.log(`\nSeeded ${seeds.length} reminders for ${user.email}.`)
  console.log(`Due cards dated ${dueDay.toFormat('ccc d LLL')}: three distinct reminders, none repeated.`)
  if (!dueIsToday) {
    console.log(
      'NOTE: run after 6:30 p.m. local for those to read "Today" — before then the\n' +
        'most recent day with every firing time passed is yesterday, and the cards say so.'
    )
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
