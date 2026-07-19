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

/**
 * Treat an empty/whitespace-only value as "not set" before validating.
 *
 * Compose passes optional config as `${VAR:-}`, which is an empty string rather
 * than an absent variable, so a validator like `.email()` would otherwise fail on
 * a deployment that simply hasn't configured that feature.
 */
function blankToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined
    return value
  }, schema.optional())
}

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
  FCM_PROJECT_ID: z.string().optional(),

  // Google OAuth WEB client id. When set, "Continue with Google" is offered and
  // ID tokens are verified against it (it's also the native serverClientId). The
  // Android client id only needs to exist in the Cloud project (package + SHA-1);
  // it isn't read here. Empty disables Google login.
  GOOGLE_WEB_CLIENT_ID: z.string().optional(),

  // App-store review access: one designated account may sign in with this fixed
  // code, because a reviewer cannot receive an emailed one-time code. Both must be
  // set for the path to exist; see lib/review-access.ts. The code is a shared
  // secret typed into a Play Console form — keep it long and rotate it after a
  // review. A short value is rejected at boot rather than silently accepted.
  // `blankToUndefined` matters here: compose.server.yml passes `${VAR:-}`, so an
  // unconfigured deployment supplies an empty string rather than nothing. Without
  // it, `.email()` / `.min(12)` would reject "" and the API would refuse to boot.
  REVIEW_ACCOUNT_EMAIL: blankToUndefined(z.string().email()),
  REVIEW_ACCOUNT_CODE: blankToUndefined(z.string().min(12, 'REVIEW_ACCOUNT_CODE must be at least 12 characters'))
})

/**
 * Every variable this app reads. Exported so a test can assert the deployment
 * actually supplies them: compose.server.yml enumerates the container's
 * environment, so a key added here but not there is silently undefined in
 * production — which is how GOOGLE_WEB_CLIENT_ID came to work only by accident,
 * via a .env baked into the image. See env.test.ts.
 */
export const envKeys = Object.keys(envSchema.shape)

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
