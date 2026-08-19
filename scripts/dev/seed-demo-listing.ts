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
 * **Runs at any hour.** Every seeded instant is derived from its own reminder's
 * schedule (see `lastPassed` and friends) rather than from one shared "due day",
 * so a fired occurrence is always in the past and a weekly one always lands on the
 * weekday its schedule names. Materialization will not disturb them: it back-fills
 * only `once` schedules, and repeating ones expand forward from now.
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
/** Resolve the account and print what would be written, then stop. Writes nothing. */
const dryRun = args.includes('--dry-run')

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

const day = (offset: number) => now.plus({ days: offset }).startOf('day')
const isoDay = (offset = 0) => day(offset).toFormat('yyyy-MM-dd')

/**
 * The most recent instant at `hhmm` that has already passed.
 *
 * Each already-fired occurrence is anchored on its own rather than to one shared
 * "due day", which is what lets this run at any hour. The previous version picked
 * a single day for all of them, so it had to be run after 6:30 p.m. (the latest
 * seeded firing) or every Due card dated itself yesterday and said so.
 */
function lastPassed(hhmm: string): Date {
  const today = at(now.startOf('day'), hhmm)
  return today.getTime() <= now.toMillis() ? today : at(day(-1), hhmm)
}

/**
 * The most recent `weekday` at `hhmm` that has already passed (Luxon numbering,
 * 1 = Monday), and its counterpart still to come.
 *
 * A weekly reminder's firings have to land on the day its own schedule names, or
 * the card contradicts the schedule the editor shows beside it. Fixed day-offsets
 * did not: seeded on a Wednesday, a Monday reminder produced a Wednesday firing.
 */
function lastPassedOn(weekday: number, hhmm: string): Date {
  let candidate = now.minus({ days: (now.weekday - weekday + 7) % 7 }).startOf('day')
  if (at(candidate, hhmm).getTime() > now.toMillis()) candidate = candidate.minus({ weeks: 1 })
  return at(candidate, hhmm)
}

function nextOn(weekday: number, hhmm: string): Date {
  let candidate = now.plus({ days: (weekday - now.weekday + 7) % 7 }).startOf('day')
  if (at(candidate, hhmm).getTime() <= now.toMillis()) candidate = candidate.plus({ weeks: 1 })
  return at(candidate, hhmm)
}

/** The same idea for a monthly reminder: the last day-of-month `dom` at `hhmm`. */
function lastPassedOnDay(dom: number, hhmm: string): Date {
  let candidate = now.set({ day: dom }).startOf('day')
  if (at(candidate, hhmm).getTime() > now.toMillis()) candidate = candidate.minus({ months: 1 })
  return at(candidate, hhmm)
}

/**
 * Every seeded instant, named. Each is derived from the reminder's own schedule
 * so the firing and the schedule beside it agree.
 */
const puppyDue = lastPassed('08:00')
const puppyDone = lastPassed('18:00')
const plantsDue = lastPassed('09:00')
const outTheDoorDue = lastPassed('08:15')
const binsDue = lastPassedOn(1, '18:30')
const timesheetNext = nextOn(5, '16:00')
const timesheetDone = lastPassedOn(5, '16:00')
const filterDone = lastPassedOnDay(1, '10:00')

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
const outTheDoor = [
  { id: 'go-1', text: 'Lunches packed' },
  { id: 'go-2', text: 'Water bottles filled' },
  { id: 'go-3', text: 'Homework in bags' },
  { id: 'go-4', text: 'Bus passes' }
]

const seeds: Seed[] = [
  {
    note: 'due — the hero; twice daily is what a "must not miss" routine looks like',
    reminder: {
      title: 'Feed the puppy',
      details: 'Half a cup of kibble, and fresh water.',
      type: 'NONE',
      schedule: { kind: 'daily', timesOfDay: ['08:00', '18:00'], skipWeekends: false },
      persistence: 'PERSISTENT',
      // No escalation on anything with a live firing: the sweep would flip it to
      // ESCALATED within a minute and the card would read "Escalated", not "Due".
      startDate: isoDay(-6)
    },
    occurrences: [
      { scheduledFor: puppyDue, status: 'FIRED', firedAt: puppyDue },
      {
        scheduledFor: puppyDone,
        status: 'ACKNOWLEDGED',
        firedAt: puppyDone,
        acknowledgedAt: new Date(puppyDone.getTime() + 6 * MINUTE)
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
    occurrences: [{ scheduledFor: plantsDue, status: 'FIRED', firedAt: plantsDue }]
  },
  {
    // The one live checklist. `checkedItems` sits on the occurrence, not the
    // reminder, so a part-ticked card is a firing's own state and a repeat starts
    // blank; leaving two ticked is what shows that a nag is about what is *left*.
    note: 'due — a part-ticked checklist, the only live one',
    reminder: {
      title: 'Get out the door',
      details: 'The 8:20 bus waits for nobody.',
      type: 'TODO',
      typeData: { items: outTheDoor },
      schedule: { kind: 'daily', timesOfDay: ['08:15'], skipWeekends: true },
      persistence: 'PERSISTENT',
      startDate: isoDay(-14)
    },
    occurrences: [
      { scheduledFor: outTheDoorDue, status: 'FIRED', firedAt: outTheDoorDue, checkedItems: ['go-1', 'go-2'] }
    ]
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
    occurrences: [{ scheduledFor: binsDue, status: 'FIRED', firedAt: binsDue }]
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
      { scheduledFor: timesheetNext, status: 'PENDING' },
      {
        scheduledFor: timesheetDone,
        status: 'ACKNOWLEDGED',
        firedAt: timesheetDone,
        acknowledgedAt: new Date(timesheetDone.getTime() + 21 * MINUTE)
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
        scheduledFor: filterDone,
        status: 'ACKNOWLEDGED',
        firedAt: filterDone,
        acknowledgedAt: new Date(filterDone.getTime() + 2 * HOUR)
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

  if (dryRun) {
    const fmt = (d: Date) => DateTime.fromJSDate(d).setZone(ZONE).toFormat('ccc d LLL yyyy, h:mm a')
    console.log(`Dry run: nothing written. Zone ${user.timeZone}${user.timeZone === ZONE ? '' : ` -> ${ZONE}`}.`)
    const existing = await prisma.reminder.count({ where: { userId: user.id } })
    console.log(`Would remove ${keep ? 0 : existing} reminder(s), then write ${seeds.length}:`)
    for (const seed of seeds) {
      console.log(`  ${String(seed.reminder.title).padEnd(26)} ${seed.note}`)
      for (const occurrence of seed.occurrences ?? []) {
        console.log(`      ${occurrence.status.padEnd(13)} ${fmt(occurrence.scheduledFor)}`)
      }
    }
    return
  }

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
  console.log('Due cards (four distinct reminders, none repeated):')
  for (const [label, when] of [
    ['Feed the puppy', puppyDue],
    ['Get out the door', outTheDoorDue],
    ['Water the plants', plantsDue],
    ['Take the bins out', binsDue]
  ] as const) {
    console.log(`  ${label.padEnd(20)} ${DateTime.fromJSDate(when).setZone(ZONE).toFormat('ccc d LLL, h:mm a')}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
