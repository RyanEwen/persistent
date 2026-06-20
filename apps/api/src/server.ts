/**
 * Process entrypoint: create the HTTP server, attach the WebSocket hub, start
 * the scheduling engine, and listen.
 */
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { attachWsHub } from './lib/ws-hub.js'
import { setHub } from './lib/realtime.js'
import { startScheduler, stopScheduler } from './lib/scheduler.js'

const app = createApp()
const server = createServer(app)

const hub = attachWsHub(server)
setHub(hub)
startScheduler()

server.listen(env.API_PORT, () => {
  logger.info(`API listening on :${env.API_PORT}`)
})

function shutdown(signal: string): void {
  logger.info(`received ${signal}, shutting down`)
  stopScheduler()
  hub.close()
  server.close(() => process.exit(0))
  // Force-exit if connections linger.
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
