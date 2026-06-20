/**
 * Single reconnecting WebSocket to /ws. Validates each event with the shared
 * Zod schema and turns it into a TanStack Query cache invalidation (the event
 * is an invalidation hint, not data). See docs/data-event-contract.md.
 */
import { wsEventSchema, type WsEvent } from '@persistent/shared'
import { queryClient, queryKeys } from './queryClient.js'

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let started = false

function wsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function handleEvent(event: WsEvent): void {
  switch (event.type) {
    case 'occurrence.fired':
    case 'occurrence.changed':
      void queryClient.invalidateQueries({ queryKey: queryKeys.occurrencesActive })
      void queryClient.invalidateQueries({ queryKey: queryKeys.occurrencesUpcoming })
      break
    case 'reminder.changed':
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders })
      void queryClient.invalidateQueries({ queryKey: queryKeys.occurrencesActive })
      void queryClient.invalidateQueries({ queryKey: queryKeys.occurrencesUpcoming })
      break
    case 'dismiss':
    case 'ping':
      break
  }
}

function connect(): void {
  socket = new WebSocket(wsUrl())
  socket.onmessage = (message) => {
    try {
      const parsed = wsEventSchema.safeParse(JSON.parse(message.data as string))
      if (parsed.success) handleEvent(parsed.data)
    } catch {
      // ignore malformed frames
    }
  }
  socket.onclose = scheduleReconnect
  socket.onerror = () => socket?.close()
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (started) connect()
  }, 3_000)
}

/** Open the connection (idempotent). Call once the user is signed in. */
export function startWs(): void {
  if (started) return
  started = true
  connect()
}

/** Close the connection and stop reconnecting. Call on sign-out. */
export function stopWs(): void {
  started = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  socket?.close()
  socket = null
}
