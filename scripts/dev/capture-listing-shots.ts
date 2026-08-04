/**
 * Render the Play listing's in-app screenshots from the running dev web app.
 *
 *   npm run dev                       # in another shell — needs web + api up
 *   npm run db:seed:demo -- --email=you@example.com
 *   npm run shots -- --email=you@example.com
 *
 * Why not a phone: these four shots are pure web UI — the Android app loads the
 * same bundle, so a scripted browser renders them identically and, unlike a
 * device, does it reproducibly. The set has to be re-shot every time the copy or
 * the UI moves (the last one went stale twice over: medication content, then a
 * fourth nav tab), and a command that regenerates it beats a phone in hand.
 *
 * **Two shots are NOT here and cannot be**: the full-screen alarm is a native
 * Kotlin activity (`AlarmActivity.kt`) and the notification shade is Android's
 * own chrome. Both need a device — see listing.md.
 *
 * Fidelity notes, in case a shot ever looks off:
 * - The container needs Roboto installed and fontconfig pointing system-ui at it,
 *   or the app's `system-ui` stack falls back to DejaVu and the type looks wrong.
 * - `GetTheAppButton` is hidden here because it renders `null` in the native app
 *   (`isNative()`), so hiding it makes this match what a store visitor installs
 *   rather than inventing a state.
 * - Sign-in is a session minted straight into the database and revoked at the
 *   end; there is no email-code dance to automate.
 */
import crypto from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import type { Page } from 'playwright'

/**
 * Playwright is deliberately NOT a dependency: it plus a browser download is a
 * standing cost on every `npm ci` for a script run a few times a year. Imported
 * on demand so the miss is one clear sentence instead of a module-resolution
 * stack.
 */
async function loadChromium() {
  try {
    return (await import('playwright')).chromium
  } catch {
    throw new Error(
      'Playwright is not installed (kept out of package.json on purpose). One-off setup:\n' +
        '  npm i --no-save --no-package-lock playwright\n' +
        '  sudo npx playwright install-deps chromium && npx playwright install chromium\n' +
        '  sudo apt-get install -y fonts-roboto   # or the type renders as DejaVu'
    )
  }
}

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1]
const baseUrl = args.find((a) => a.startsWith('--url='))?.split('=')[1] ?? 'http://localhost:5173'
const outDir =
  args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'apps/mobile/store/graphics/screenshots'

/**
 * A Pixel 9 Pro's CSS viewport at 2.5x. Gives 1120x2495 — inside Play's
 * 320..3840 per side, and the same 0.449 aspect as the device captures it sits
 * beside in the carousel.
 */
const VIEWPORT = { width: 448, height: 998 }
const SCALE = 2.5

/**
 * Drop the two web-only nudges toward the Android app. Both render `null` under
 * `isNative()`, so removing them is what a store visitor actually installs.
 *
 * The banner goes via the app's own dismissal key rather than CSS: it is one
 * sentence with a link in the middle of it, and hiding the link alone leaves
 * "Install the for reliable, undismissable alarms" in the shot.
 */
const BANNER_DISMISSED_KEY = 'persistent-hide-app-banner'

async function hideWebOnlyChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const anchor of document.querySelectorAll('a')) {
      if (anchor.textContent?.trim() === 'Get the app') {
        ;(anchor as HTMLElement).style.display = 'none'
      }
    }
  })
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await hideWebOnlyChrome(page)
  // Joy renders its background pattern and icons after hydration; without this a
  // shot can catch a half-painted card.
  await page.waitForTimeout(400)
}

async function main(): Promise<void> {
  if (!emailArg) throw new Error('Pass --email=<the seeded demo account>.')
  const user = await prisma.user.findUnique({ where: { email: emailArg } })
  if (!user) throw new Error(`No user with email ${emailArg}.`)

  const hero = await prisma.reminder.findFirst({ where: { userId: user.id, title: 'Feed the puppy' } })
  const escalating = await prisma.reminder.findFirst({ where: { userId: user.id, title: 'Submit the timesheet' } })
  if (!hero || !escalating) throw new Error('Seed the demo account first: npm run db:seed:demo.')

  // Mint a session rather than driving the sign-in form: the code arrives by
  // email, which is not automatable, and this is the same row that flow creates.
  const secret = crypto.randomBytes(32).toString('base64url')
  const secretHash = crypto.createHash('sha256').update(secret).digest('base64url')
  const session = await prisma.session.create({
    data: {
      secretHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      lastSeenAt: new Date(),
      userAgent: 'capture-listing-shots'
    }
  })

  mkdirSync(outDir, { recursive: true })
  const browser = await (await loadChromium()).launch()
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      colorScheme: 'dark',
      locale: 'en-CA',
      // Must match the demo account's zone, or the times render shifted — the
      // same trap the seed script fixes on the account itself.
      timezoneId: 'America/Toronto'
    })
    await context.addCookies([
      { name: 'persistent_auth', value: secret, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }
    ])
    await context.addInitScript((key) => localStorage.setItem(key, '1'), BANNER_DISMISSED_KEY)
    const page = await context.newPage()

    const shots: { file: string; go: () => Promise<void>; shows: string }[] = [
      {
        file: '01-current.png',
        shows: 'Three distinct reminders still waiting to be confirmed, each with its own Done',
        go: async () => {
          await page.goto(`${baseUrl}/`)
          await page.getByText('Feed the puppy').first().waitFor()
        }
      },
      {
        file: '02-reminder-detail.png',
        shows: 'Reminder detail: the 3x daily schedule and what it is still waiting on',
        go: async () => {
          await page.goto(`${baseUrl}/reminders/${hero.id}`)
          await page.getByText('Every day at').first().waitFor()
        }
      },
      {
        file: '03-escalation-settings.png',
        shows: 'Escalate-to-alarm settings: delay presets, escalate-at-a-time, email a contact',
        go: async () => {
          await page.goto(`${baseUrl}/reminders/${escalating.id}/edit`)
          await page.getByRole('tab', { name: 'Escalation' }).click()
          await page.getByText('Escalate to an alarm if ignored').waitFor()
        }
      },
      {
        file: '05-history.png',
        shows: 'History: what was confirmed and when',
        go: async () => {
          await page.goto(`${baseUrl}/history`)
          await page.getByText('Feed the puppy').first().waitFor()
        }
      }
    ]

    for (const shot of shots) {
      await shot.go()
      await settle(page)
      await page.screenshot({ path: `${outDir}/${shot.file}` })
      console.log(`  ${shot.file.padEnd(30)} ${shot.shows}`)
    }
    await context.close()
  } finally {
    await browser.close()
    // Not swallowed: failing to revoke leaves a live session for this account
    // for an hour. Harmless on a dev box, worth knowing about anywhere else —
    // and the id is enough to delete it by hand.
    await prisma.session
      .delete({ where: { id: session.id } })
      .catch((error) => console.warn(`WARN: could not revoke session ${session.id}: ${String(error)}`))
  }

  console.log(`\nWrote 4 shots to ${outDir} at ${VIEWPORT.width * SCALE}x${VIEWPORT.height * SCALE}.`)
  console.log('Still device-only: 00-ringing-alarm (native activity), 04-notification-actions (Android shade).')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
