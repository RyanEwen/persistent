/**
 * Per-user WebSocket hub at `/ws`.
 *
 * Each socket is authenticated from the session cookie during the HTTP upgrade
 * and bound to its userId. `broadcast(userId, event)` fans an event to all of
 * that user's open clients. Events are invalidation hints for the web client's
 * TanStack Query caches (see docs/data-event-contract.md).
 */
import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { WsEvent } from '@persistent/shared'
import { resolveUserId } from './auth-session.js'
import { logger } from './logger.js'

interface TaggedSocket extends WebSocket {
  userId?: string
  isAlive?: boolean
}

export interface WsHub {
  broadcast(userId: string, event: WsEvent): void
  close(): void
}

export function attachWsHub(server: Server): WsHub {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    if (!request.url || new URL(request.url, 'http://localhost').pathname !== '/ws') {
      return
    }
    // The upgrade request carries cookies; reuse the normal session resolver.
    resolveUserId(request as never)
      .then((userId) => {
        if (!userId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          const tagged = ws as TaggedSocket
          tagged.userId = userId
          tagged.isAlive = true
          wss.emit('connection', tagged, request)
        })
      })
      .catch((error) => {
        logger.warn('ws upgrade auth failed', { error: String(error) })
        socket.destroy()
      })
  })

  wss.on('connection', (ws: TaggedSocket) => {
    ws.on('pong', () => {
      ws.isAlive = true
    })
  })

  // Heartbeat: drop sockets that stop responding, ping the rest.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const tagged = client as TaggedSocket
      if (tagged.isAlive === false) {
        tagged.terminate()
        continue
      }
      tagged.isAlive = false
      tagged.ping()
    }
  }, 30_000)
  heartbeat.unref()

  return {
    broadcast(userId, event) {
      const message = JSON.stringify(event)
      for (const client of wss.clients) {
        const tagged = client as TaggedSocket
        if (tagged.userId === userId && tagged.readyState === WebSocket.OPEN) {
          tagged.send(message)
        }
      }
    },
    close() {
      clearInterval(heartbeat)
      wss.close()
    }
  }
}
