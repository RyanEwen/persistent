/**
 * Passwordless email one-time-code issuing + verification.
 *
 * Requesting a code is both sign-up and sign-in. Codes are stored hashed, are
 * single-use, expire quickly, and are rate-limited per email. In demo mode the
 * cleartext code is returned to the caller instead of emailed.
 */
import crypto from 'node:crypto'
import { prisma } from './prisma.js'
import { demoMode } from './env.js'
import { logger } from './logger.js'
import { tooManyRequests } from './http-error.js'
import { sendCloudflareEmail, isEmailConfigured } from './cloudflare-email.js'

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_CODES_PER_WINDOW = 5
const RATE_WINDOW_MS = 15 * 60 * 1000
const MAX_VERIFY_ATTEMPTS = 6

export interface IssueResult {
  expiresAt: Date
  /** Cleartext code, non-null only in demo mode. */
  previewCode: string | null
}

function generateCode(): string {
  // 6-digit numeric, leading zeros preserved.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

function hashCode(email: string, code: string): string {
  // Bind the hash to the email so a leaked hash can't be replayed for another address.
  return crypto.createHash('sha256').update(`${email}:${code}`).digest('base64url')
}

export async function issueEmailCode(email: string): Promise<IssueResult> {
  const since = new Date(Date.now() - RATE_WINDOW_MS)
  const recent = await prisma.emailCode.count({ where: { email, createdAt: { gte: since } } })
  if (recent >= MAX_CODES_PER_WINDOW) {
    throw tooManyRequests('Too many sign-in codes requested. Try again in a few minutes.')
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)
  await prisma.emailCode.create({
    data: { email, codeHash: hashCode(email, code), expiresAt }
  })

  if (demoMode || !isEmailConfigured()) {
    logger.info('Issued sign-in code (demo/no-email mode).', { email, expiresAt: expiresAt.toISOString() })
    return { expiresAt, previewCode: code }
  }

  await sendCloudflareEmail({
    to: email,
    subject: 'Your Persistent sign-in code',
    text: buildText(code, expiresAt),
    html: buildHtml(code, expiresAt)
  })
  logger.info('Sent sign-in code email.', { email, expiresAt: expiresAt.toISOString() })
  return { expiresAt, previewCode: null }
}

/** Returns true if the code is valid; consumes it (and sibling codes) on success. */
export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const record = await prisma.emailCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  })
  if (!record) return false

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    await prisma.emailCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } })
    return false
  }

  const matches = crypto.timingSafeEqual(
    Buffer.from(record.codeHash),
    Buffer.from(hashCode(email, code))
  )

  if (!matches) {
    await prisma.emailCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } })
    return false
  }

  // Consume this and any other outstanding codes for the email.
  await prisma.emailCode.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: new Date() }
  })
  return true
}

function buildText(code: string, expiresAt: Date): string {
  return [
    'Use this one-time code to sign in to Persistent:',
    '',
    code,
    '',
    `This code expires at ${expiresAt.toUTCString()}.`,
    'If you did not request this code, you can ignore this email.'
  ].join('\n')
}

function buildHtml(code: string, expiresAt: Date): string {
  return [
    '<p>Use this one-time code to sign in to Persistent:</p>',
    `<p><strong style="font-size:1.5rem;letter-spacing:0.12em;font-family:ui-monospace,Menlo,monospace;">${code}</strong></p>`,
    `<p>This code expires at ${expiresAt.toUTCString()}.</p>`,
    '<p>If you did not request this code, you can ignore this email.</p>'
  ].join('')
}
