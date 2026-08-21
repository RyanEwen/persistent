/**
 * Which of a reminder's own tones apply to one firing.
 *
 * A reminder stores three (`reminderSoundsSchema`) and any single firing plays at
 * most two of them, picked by whether it rings: an alarm loops one continuous tone
 * and has no follow-up to re-tone, so it carries no nag tone at all — the same rule
 * the device applies to `nagSoundUri`.
 *
 * It lives here rather than at each call site because two paths must answer it
 * identically: the device-alarm list a device arms from, and the push payload a
 * device that armed nothing acts on. A reminder has to ring the same either way.
 */
import { toReminderSounds, type SoundChoice } from '@persistent/shared'

export interface FiringSounds {
  /** The reminder's own tone for this firing, or null to use the device's. */
  sound: SoundChoice | null
  /** The reminder's own tone for the re-sound loop; always null when the firing rings. */
  nagSound: SoundChoice | null
}

export function firingSounds(sounds: unknown, alarm: boolean): FiringSounds {
  const chosen = toReminderSounds(sounds)
  return {
    sound: alarm ? chosen.alarm : chosen.notification,
    nagSound: alarm ? null : chosen.nag
  }
}
