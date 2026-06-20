/**
 * Centralized environment access. Feature code imports `env` from here instead
 * of reading `process.env` directly, so config is validated and typed in one
 * place. Mirrors printstream's env pattern.
 */
import 'dotenv/config'
import { z } from 'zod'

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1')

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  DEMO_MODE: booleanish,
  // In production a single container can serve the built web app from this dir
  // (same origin as the API). Unset in dev, where Vite serves the web.
  WEB_DIST_DIR: z.string().optional(),

  CLOUDFLARE_EMAIL_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_EMAIL_API_TOKEN: z.string().optional(),
  CLOUDFLARE_EMAIL_FROM_EMAIL: z.string().optional(),
  CLOUDFLARE_EMAIL_FROM_NAME: z.string().optional(),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),
  FCM_PROJECT_ID: z.string().optional()
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}`)
}

export const env = parsed.data

/** Allowed browser origins, parsed from the comma-separated CLIENT_ORIGIN. */
export const clientOrigins = env.CLIENT_ORIGIN.split(',')
  .map((value) => value.trim())
  .filter(Boolean)

export const isProduction = env.NODE_ENV === 'production'
/** Demo mode returns sign-in codes in the response; never enable in production. */
export const demoMode = env.DEMO_MODE && !isProduction
