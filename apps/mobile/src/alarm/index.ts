/**
 * Registers the native AlarmPlugin so the web layer can call it. On non-native
 * platforms the methods are no-ops (web uses the service-worker path instead).
 */
import { registerPlugin, Capacitor } from '@capacitor/core'
import type { AlarmPluginPlugin } from './definitions.js'

export const AlarmPlugin = registerPlugin<AlarmPluginPlugin>('AlarmPlugin')

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export type { AlarmPluginPlugin, ScheduledAlarm } from './definitions.js'
