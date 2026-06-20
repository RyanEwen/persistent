/**
 * Express app wiring: security middleware, CORS, body parsing, the session
 * resolver, the API routers, and the JSON error handler. The HTTP server +
 * WebSocket hub + scheduler are started in server.ts.
 */
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { clientOrigins } from './lib/env.js'
import { attachUser } from './lib/auth-middleware.js'
import { HttpError } from './lib/http-error.js'
import { logger } from './lib/logger.js'
import { authRouter } from './routes/auth.js'
import { remindersRouter } from './routes/reminders.js'
import { occurrencesRouter } from './routes/occurrences.js'
import { pushRouter } from './routes/push.js'
import { syncRouter } from './routes/sync.js'

export function createApp() {
  const app = express()
  // Behind a reverse proxy in production: trust X-Forwarded-* for req.ip and secure cookies.
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(
    cors({
      origin: clientOrigins.length > 0 ? clientOrigins : true,
      credentials: true
    })
  )
  app.use(express.json({ limit: '256kb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true })
  })

  // Resolve the session cookie into request.userId for every API request.
  app.use(attachUser)

  app.use('/api/auth', authRouter)
  app.use('/api/reminders', remindersRouter)
  app.use('/api/occurrences', occurrencesRouter)
  app.use('/api/push', pushRouter)
  app.use('/api/sync', syncRouter)

  // 404 for unknown API routes.
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found.' })
  })

  // Centralized JSON error handler.
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      response.status(error.statusCode).json({ error: error.message })
      return
    }
    logger.error('unhandled error', { error: String(error) })
    response.status(500).json({ error: 'Internal server error.' })
  })

  return app
}
