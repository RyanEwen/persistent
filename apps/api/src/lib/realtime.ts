/**
 * Holds the process-wide WsHub so both the scheduler and route handlers can
 * broadcast without threading the hub through every call site.
 */
import type { WsHub } from './ws-hub.js'
import type { WsEvent } from '@persistent/shared'

let hub: WsHub | null = null

export function setHub(value: WsHub): void {
  hub = value
}

export function broadcast(userId: string, event: WsEvent): void {
  hub?.broadcast(userId, event)
}
