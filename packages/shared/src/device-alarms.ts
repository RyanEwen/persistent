/**
 * The device-alarm contract: the server expands each active occurrence into the
 * concrete on-device alarms the Android client should arm (a main fire plus, when
 * escalation is configured and still pending, a second escalation alarm). Computed
 * once, server-side, so the JS bridge and the native background sync worker arm
 * identical alarms from a single source — no occurrence->alarm logic duplicated.
 *
 * Sound is the one thing split between the two. The *device's* tones live in
 * per-device settings and the server has never seen them, so it emits `soundKind`
 * and the consumer fills the URI locally. A *reminder's* own tone is a reminder
 * field, so the server does send it (`sound` / `nagSound`) — and the consumer still
 * has work to do, because the URI was picked on some other device and may not
 * resolve here. Either way the consumer resolves; the server only says what it knows.
 */
import { z } from 'zod'
import { shadeProminenceSchema, soundChoiceSchema } from './reminders.js'

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
  /** Which per-device tone to fall back to: the alarm tone or the notification tone. */
  soundKind: z.enum(['alarm', 'notification']),
  /**
   * The reminder's own tone for this alarm's `soundKind`, or null when it overrides
   * nothing and the device's tone applies. Picked on whichever device the user set
   * it from, so the consumer resolves rather than trusting it (`soundChoiceSchema`).
   */
  sound: soundChoiceSchema.nullable(),
  /**
   * The reminder's own tone for the `soundIntervalSeconds` re-sound loop. Always null
   * on an alarm, which loops one continuous tone and has no follow-up to re-tone.
   */
  nagSound: soundChoiceSchema.nullable(),
  /** Parent reminder id, so tapping the notification can open its editor. */
  reminderId: z.string(),
  /** Shade placement (visual only); ignored for alarms/escalations. */
  shadeProminence: shadeProminenceSchema
})

export type DeviceAlarm = z.infer<typeof deviceAlarmSchema>

/**
 * One entry in the device's **agenda**: what it can LIST, as against what it arms.
 *
 * The armed set is deliberately narrow — everything due plus the server's 48-hour
 * window — because every entry in it is an exact alarm the OS has to hold. That makes
 * it the wrong answer to "show me my reminders", which is what the Android Auto screen
 * asks: a driver checking the list wants the week, and wants the notes they keep for
 * reference, neither of which should arm anything.
 *
 * So the agenda is read-only by construction. It carries no sound, no persistence
 * level and no escalation instant — nothing that could ring — and the device stores it
 * apart from the alarm set (`AgendaStore`, never `AlarmStore`) so no code path that
 * arms alarms can reach it. Where the two describe the same occurrence, the alarm set
 * wins: it is what the phone is actually about to do.
 */
export const deviceAgendaEntrySchema = z.object({
  /** The firing this entry is about — empty for a note, which never has one. */
  occurrenceId: z.string(),
  reminderId: z.string(),
  title: z.string(),
  /** The firing's *unticked* checklist items / description, cut server-side as everywhere. */
  body: z.string(),
  /** Epoch milliseconds it is due; 0 for a note, which is never due. */
  fireAtMs: z.number(),
  /**
   * A note (schedule kind `never`): kept to be read, with no firing to act on. Flagged
   * rather than inferred from an empty `occurrenceId`, so a surface can't accidentally
   * offer Done on one and queue an ack against nothing.
   */
  note: z.boolean()
})

export type DeviceAgendaEntry = z.infer<typeof deviceAgendaEntrySchema>
