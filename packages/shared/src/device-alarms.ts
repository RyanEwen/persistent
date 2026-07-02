/**
 * The device-alarm contract: the server expands each active occurrence into the
 * concrete on-device alarms the Android client should arm (a main fire plus, when
 * escalation is configured and still pending, a second escalation alarm). Computed
 * once, server-side, so the JS bridge and the native background sync worker arm
 * identical alarms from a single source — no occurrence->alarm logic duplicated.
 *
 * The one field the server can't know is the concrete sound URI (the user's chosen
 * tone lives in per-device settings), so it emits `soundKind` and the consumer
 * fills the URI from local settings.
 */
import { z } from 'zod'
import { shadeProminenceSchema } from './reminders.js'

/**
 * The escalation alarm is a second device alarm keyed off the occurrence id with
 * this suffix, so it can be armed / cancelled / acked alongside the main one. Kept
 * in lockstep with `AlarmReceiver.ESC_SUFFIX` (Kotlin).
 */
export const ESC_SUFFIX = '::esc'

export const deviceAlarmSchema = z.object({
  /** Occurrence id (the alarm's stable key); an escalation alarm carries the '::esc' suffix. */
  occurrenceId: z.string(),
  /** Epoch milliseconds when the alarm should fire. */
  fireAtMs: z.number(),
  title: z.string(),
  body: z.string(),
  /** Loop the alarm sound every N seconds until acknowledged; 0 = single sound. */
  soundIntervalSeconds: z.number(),
  /** ALARM: looping sound + full-screen until Done. Otherwise a sound-once notification. */
  alarm: z.boolean(),
  /** Stays put / re-appears if swiped. */
  ongoing: z.boolean(),
  /** An escalation the user may silence back to a soft nag (never for inherent ALARM reminders). */
  canSilence: z.boolean(),
  /** Which per-device tone to play: the alarm tone or the notification tone. */
  soundKind: z.enum(['alarm', 'notification']),
  /** Parent reminder id, so tapping the notification can open its editor. */
  reminderId: z.string(),
  /** Shade placement (visual only); ignored for alarms/escalations. */
  shadeProminence: shadeProminenceSchema
})

export type DeviceAlarm = z.infer<typeof deviceAlarmSchema>
