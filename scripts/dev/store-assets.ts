/** Repeatable store demo preparation and asset exports, without launching a browser. */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { inspectStorePng, validateStoreImage } from './store-image.ts'

const DEMO_EMAIL = 'ryan.ewen+persistentdemo@gmail.com'
const RECIPIENT_EMAIL = 'alex@example.test'
const RECIPIENT_NAME = 'Persistent screenshot recipient'

/** Seed only the known development demo account, and expose synthetic scenario ids. */
async function prepare(): Promise<void> {
  const email = process.argv.find((arg) => arg.startsWith('--email='))?.slice(8)
  if (email !== DEMO_EMAIL) throw new Error(`Pass --email=${DEMO_EMAIL}. Personal accounts are not capture fixtures.`)
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!['database', 'localhost', '127.0.0.1', 'persistent-database-1'].includes(host)) {
    throw new Error('Store preparation requires the isolated development database.')
  }
  const prisma = new PrismaClient()
  try {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, displayName: 'Store demo', timeZone: 'America/Toronto' },
      update: {}
    })
    const existingRecipient = await prisma.user.findUnique({ where: { email: RECIPIENT_EMAIL } })
    if (existingRecipient && existingRecipient.displayName !== RECIPIENT_NAME) {
      throw new Error('The sample recipient already exists outside this fixture. Refusing to replace their data.')
    }
    // This existing seed owns all dates, doses, and checked-item examples.
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/dev/seed-demo-listing.ts', `--email=${email}`], { stdio: 'inherit' })
    await prisma.$transaction(async (tx) => {
      const recipient = await tx.user.upsert({
        where: { email: RECIPIENT_EMAIL },
        create: { email: RECIPIENT_EMAIL, displayName: RECIPIENT_NAME, timeZone: 'America/Toronto' },
        update: {}
      })
      await tx.reminderAssignment.deleteMany({ where: { creatorId: user.id, recipientId: recipient.id } })
      await tx.reminder.deleteMany({ where: { userId: recipient.id } })
      const finishedAt = new Date(Date.now() - 60 * 60_000)
      const reminder = await tx.reminder.create({ data: {
        userId: recipient.id, title: 'Pick up the parcel',
        schedule: { kind: 'none', timesOfDay: [] },
        startDate: finishedAt.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
      } })
      await tx.reminderOccurrence.create({ data: {
        userId: recipient.id, reminderId: reminder.id, status: 'ACKNOWLEDGED',
        scheduledFor: new Date(finishedAt.getTime() - 15 * 60_000),
        firedAt: new Date(finishedAt.getTime() - 15 * 60_000), acknowledgedAt: finishedAt
      } })
      await tx.reminderAssignment.create({ data: {
        creatorId: user.id, recipientId: recipient.id, recipientEmail: RECIPIENT_EMAIL,
        reminderId: reminder.id, title: reminder.title, state: 'ACTIVE',
        acceptedAt: new Date(finishedAt.getTime() - 30 * 60_000), lastCompletedAt: finishedAt
      } })
    })
    const reminders = await prisma.reminder.findMany({ where: { userId: user.id }, select: { id: true, title: true } })
    mkdirSync('store-assets', { recursive: true })
    writeFileSync('store-assets/fixture.json', JSON.stringify({
      capturedAgainst: 'development', email, preparedAt: new Date().toISOString(),
      timeZone: 'America/Toronto', reminders
    }, null, 2) + '\n')
    console.log('Prepared synthetic store fixture. Scenario ids: store-assets/fixture.json')
  } finally {
    await prisma.$disconnect()
  }
}

/** Decode a Paseo MCP image block from stdin; never log its base64 payload. */
async function saveCapture(path: string): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const input = Buffer.concat(chunks).toString().trim()
  const bytes = Buffer.from(input, 'base64')
  const { width, height } = inspectStorePng(bytes)
  const target = resolve(path)
  if (!target.startsWith(resolve('store-assets') + '/')) throw new Error('Captures belong under store-assets/.')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
  console.log(`Saved ${path}: ${width}x${height}`)
}

/** Check the curated files against the stores' pixel and encoding requirements. */
function check(): void {
  const manifest = JSON.parse(readFileSync('store-assets/manifest.json', 'utf8')) as {
    play: Array<{ file: string }>; microsoft: Array<{ file: string }>
  }
  const selectedStore = process.argv.find((arg) => arg.startsWith('--store='))?.slice(8)
  if (selectedStore && !['play', 'microsoft'].includes(selectedStore)) throw new Error('Expected --store=play or --store=microsoft.')
  for (const [store, shots] of Object.entries(manifest)) {
    if (store !== 'play' && store !== 'microsoft') continue
    if (selectedStore && selectedStore !== store) continue
    if (shots.length < 4) throw new Error(`${store}: expected at least four curated screenshots`)
    if (store === 'play' && shots.length > 8) throw new Error('play: the carousel supports at most eight screenshots')
    for (const shot of shots) {
      const png = readFileSync(resolve('store-assets', shot.file))
      const { width, height } = validateStoreImage(png, store)
      console.log(`${store}: ${shot.file} (${width}x${height})`)
    }
  }
}

/** Replace the upload carousel only after every curated export has passed validation. */
function syncPlay(): void {
  check()
  const manifest = JSON.parse(readFileSync('store-assets/manifest.json', 'utf8')) as {
    play: Array<{ file: string }>
  }
  const directory = 'apps/mobile/store/graphics/screenshots'
  const names = new Set(manifest.play.map((shot) => basename(shot.file)))
  mkdirSync(directory, { recursive: true })

  // Finish copying the replacement set before removing superseded PNGs.
  for (const shot of manifest.play) {
    copyFileSync(resolve('store-assets', shot.file), resolve(directory, basename(shot.file)))
  }
  for (const name of readdirSync(directory)) {
    if (name.endsWith('.png') && !names.has(name)) unlinkSync(resolve(directory, name))
  }
  console.log('Synchronized the local Play upload directory. Nothing was published.')
}

const command = process.argv[2]
if (command === 'help') console.log('Capture workflow: store-assets/README.md. Use shots:prepare, Paseo browser captures, shots:render, shots:check, then shots:sync. No browser is launched automatically.')
else if (command === 'prepare') await prepare()
else if (command === 'save' && process.argv[3]) await saveCapture(process.argv[3])
else if (command === 'check') check()
else if (command === 'sync-play') syncPlay()
else throw new Error('Usage: store-assets.ts prepare --email=... | save store-assets/path.png | check | sync-play')
