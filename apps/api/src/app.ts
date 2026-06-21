/**
 * Express app wiring: security middleware, CORS, body parsing, the session
 * resolver, the API routers, and the JSON error handler. The HTTP server +
 * WebSocket hub + scheduler are started in server.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { clientOrigins, env } from './lib/env.js'
import { attachUser } from './lib/auth-middleware.js'
import { HttpError } from './lib/http-error.js'
import { logger } from './lib/logger.js'
import { authRouter } from './routes/auth.js'
import { remindersRouter } from './routes/reminders.js'
import { occurrencesRouter } from './routes/occurrences.js'
import { pushRouter } from './routes/push.js'
import { syncRouter } from './routes/sync.js'
import { appReleaseRouter } from './routes/app-release.js'

export function createApp() {
  const app = express()
  // Behind a reverse proxy in production: trust X-Forwarded-* for req.ip and secure cookies.
  app.set('trust proxy', 1)
  // CSP locked to same-origin, plus Google Identity Services (Sign in with Google)
  // which loads a cross-origin script + iframe and connects to accounts.google.com.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
          'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
          'frame-src': ["'self'", 'https://accounts.google.com/gsi/'],
          'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com']
        }
      }
    })
  )
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
  app.use('/api/app', appReleaseRouter)

  // 404 for unknown API routes.
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found.' })
  })

  // In production, serve the built web app from the same origin (no CORS, cookies
  // are first-party). The service worker is served with no-cache so updates land.
  const webDir = env.WEB_DIST_DIR?.trim()
  if (webDir && existsSync(webDir)) {
    // Serve the passkey asset-links with an EXACT `application/json` content type
    // (no charset). Play Services' on-device Digital Asset Links validator is
    // stricter than Google's crawler and rejects `application/json; charset=utf-8`
    // with "RP ID cannot be validated", which express.static would otherwise send.
    const assetLinksPath = path.join(webDir, '.well-known', 'assetlinks.json')
    if (existsSync(assetLinksPath)) {
      app.get('/.well-known/assetlinks.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'public, max-age=300')
        response.send(readFileSync(assetLinksPath))
      })
    }
    // `dotfiles: 'allow'` so /.well-known/assetlinks.json (passkey app linking)
    // is served instead of falling through to the SPA handler.
    app.use(express.static(webDir, { index: false, dotfiles: 'allow' }))
    // SPA fallback. Express 5 (path-to-regexp v8) rejects the bare '*' string
    // route, so match with a RegExp and skip API/WS paths.
    app.get(/.*/, (request, response, next) => {
      if (request.path.startsWith('/api') || request.path === '/ws') return next()
      response.sendFile(path.join(webDir, 'index.html'))
    })
  }

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
