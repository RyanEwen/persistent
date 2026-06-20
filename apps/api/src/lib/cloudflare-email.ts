/**
 * Cloudflare Email Sending transport, shared by sign-in codes and escalation
 * emails. Ported from printstream. Returns a 503 HttpError when unconfigured so
 * callers can fall back to demo mode locally.
 */
import { env } from './env.js'
import { HttpError } from './http-error.js'

interface CloudflareEmailInput {
  to: string
  subject: string
  text: string
  html?: string
  fromEmail?: string
  fromName?: string | null
}

interface CloudflareEmailConfig {
  accountId: string
  apiToken: string
  fromEmail: string
  fromName: string | null
}

export function isEmailConfigured(): boolean {
  return Boolean(
    env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim() &&
      env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() &&
      env.CLOUDFLARE_EMAIL_FROM_EMAIL?.trim()
  )
}

export async function sendCloudflareEmail(input: CloudflareEmailInput): Promise<void> {
  const config = readCloudflareEmailConfig()
  if (!config) {
    throw new HttpError(503, 'Email delivery is not configured.')
  }

  const fromEmail = input.fromEmail?.trim() || config.fromEmail
  const fromName = input.fromName === undefined ? config.fromName : input.fromName?.trim() || null
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/email/sending/send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        to: input.to,
        from: formatEmailAddress(fromEmail, fromName),
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {})
      })
    }
  )

  const result = await response.json().catch(() => null)
  if (!response.ok || isCloudflareFailure(result)) {
    throw new HttpError(502, 'Email delivery failed.')
  }
}

function isCloudflareFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return 'success' in value && (value as { success?: unknown }).success === false
}

function readCloudflareEmailConfig(): CloudflareEmailConfig | null {
  const accountId = env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim()
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim()
  const fromEmail = env.CLOUDFLARE_EMAIL_FROM_EMAIL?.trim()
  if (!accountId && !apiToken && !fromEmail) return null
  if (!accountId || !apiToken || !fromEmail) {
    throw new HttpError(503, 'Email delivery is misconfigured.')
  }
  return { accountId, apiToken, fromEmail, fromName: env.CLOUDFLARE_EMAIL_FROM_NAME?.trim() || null }
}

function formatEmailAddress(email: string, name: string | null): string {
  if (!name) return email
  return `${name.replaceAll('"', '\\"')} <${email}>`
}
