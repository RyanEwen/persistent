/**
 * Client-side display preferences (persisted to localStorage). Currently the
 * 12h/24h time format used by lib/datetime.ts. These are per-device UI prefs,
 * not server-synced account settings.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { SoundChoice } from '@persistent/shared'
import { detectTimeFormat, type TimeFormat } from '../lib/datetime.js'
import { readDoodleColor, type DoodleColorId } from './doodleColors.js'
import { readThemeId, DEFAULT_THEME_ID, type ThemeId } from './themes.js'

const STORAGE_KEY = 'persistent-settings'

/**
 * A picked tone, `{ uri, title }` — the same shape a *reminder* stores, so it comes
 * from the shared contract rather than being declared twice. Here `uri: ''` means
 * the system default for the kind. Re-exported because this module is where the
 * device's own tones live, and most callers reach for them together.
 */
export type { SoundChoice }

/** Device default for where reminders sit in the Android shade (visual only). */
export type ShadeDefault = 'NORMAL' | 'MINIMIZED'

interface Settings {
  timeFormat: TimeFormat
  themeId: ThemeId
  /** Wallpaper preference, independent of the selected color palette. */
  doodles: boolean
  /** Color family; its permitted light/dark shade follows the active theme. */
  doodleColor: DoodleColorId
  alarmSound: SoundChoice
  notificationSound: SoundChoice
  /**
   * Tone for the follow-up nags — each re-sound of a PERSISTENT notification that
   * hasn't been confirmed. Separate from `notificationSound` (the first fire) so a
   * repeat can be made more insistent, or quieter, than the original. Default
   * (empty uri) reuses the notification tone, which is the old behavior.
   */
  nagSound: SoundChoice
  shadeProminence: ShadeDefault
}

/**
 * Persisted state. `timeFormat` is only stored once the user explicitly picks
 * one; until then we re-detect from the locale on every load (so a corrected
 * detection takes effect and isn't pinned by an earlier auto-captured value).
 */
interface StoredState extends Settings {
  timeFormatChosen: boolean
  /** The one-time switch from legacy Navy defaults has been applied on this device. */
  themeDefaultMigrated: boolean
}

interface SettingsContextValue extends Settings {
  setTimeFormat: (format: TimeFormat) => void
  setThemeId: (id: ThemeId) => void
  setDoodles: (enabled: boolean) => void
  setDoodleColor: (id: DoodleColorId) => void
  setAlarmSound: (sound: SoundChoice) => void
  setNotificationSound: (sound: SoundChoice) => void
  setNagSound: (sound: SoundChoice) => void
  setShadeProminence: (prominence: ShadeDefault) => void
}

const DEFAULT_SOUND: SoundChoice = { uri: '', title: 'Default' }

/** Save device preferences; unavailable storage must not prevent using the app. */
function saveSettings(settings: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Retain the in-memory choice when storage is unavailable.
  }
}

function toSound(value: unknown): SoundChoice {
  if (value && typeof value === 'object' && 'uri' in value && typeof (value as SoundChoice).uri === 'string') {
    const v = value as SoundChoice
    return { uri: v.uri, title: typeof v.title === 'string' && v.title ? v.title : 'Default' }
  }
  return DEFAULT_SOUND
}

/** Preserve the old wallpaper only while migrating settings without a doodles field. */
function legacyDoodles(themeId: string): boolean {
  // Palette migration must not change whether the old wallpaper was enabled.
  // Match system and unknown ids preserve the existing default wallpaper choice.
  return !['plain', 'light', 'dark', 'forest', 'plum'].includes(themeId)
}

/** Load device preferences and persist the one-time Navy default and wallpaper migrations. */
function loadSettings(): StoredState {
  const defaults: StoredState = {
    timeFormat: detectTimeFormat(),
    timeFormatChosen: false,
    themeDefaultMigrated: true,
    themeId: DEFAULT_THEME_ID,
    doodles: true,
    doodleColor: 'theme',
    alarmSound: DEFAULT_SOUND,
    notificationSound: DEFAULT_SOUND,
    nagSound: DEFAULT_SOUND,
    shadeProminence: 'NORMAL'
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>
      const chosen =
        parsed.timeFormatChosen === true && (parsed.timeFormat === '12h' || parsed.timeFormat === '24h')
      const savedThemeId = readThemeId(parsed.themeId)
      // Earlier settings captured Navy even when users never picked a theme.
      // Mark the migration so explicitly choosing Navy afterward survives reload.
      const themeId = parsed.themeDefaultMigrated !== true && savedThemeId === 'doodle'
        ? DEFAULT_THEME_ID
        : savedThemeId
      const doodles = typeof parsed.doodles === 'boolean' ? parsed.doodles : legacyDoodles(typeof parsed.themeId === 'string' ? parsed.themeId : defaults.themeId)

      const settings: StoredState = {
        // Honor an explicit choice; otherwise re-detect (ignores values that were
        // auto-captured by an unrelated setting change).
        timeFormat: chosen ? (parsed.timeFormat as TimeFormat) : defaults.timeFormat,
        timeFormatChosen: chosen,
        themeDefaultMigrated: true,
        themeId,
        doodles,
        doodleColor: readDoodleColor(parsed.doodleColor),
        alarmSound: toSound(parsed.alarmSound),
        notificationSound: toSound(parsed.notificationSound),
        nagSound: toSound(parsed.nagSound),
        shadeProminence: parsed.shadeProminence === 'MINIMIZED' ? 'MINIMIZED' : 'NORMAL'
      }
      if (parsed.themeDefaultMigrated !== true) saveSettings(settings)
      return settings
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoredState>(loadSettings)

  function update(patch: Partial<StoredState>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  const value: SettingsContextValue = {
    ...settings,
    setTimeFormat: (timeFormat) => update({ timeFormat, timeFormatChosen: true }),
    setThemeId: (themeId) => update({ themeId }),
    setDoodles: (doodles) => update({ doodles }),
    setDoodleColor: (doodleColor) => update({ doodleColor }),
    setAlarmSound: (alarmSound) => update({ alarmSound }),
    setNotificationSound: (notificationSound) => update({ notificationSound }),
    setNagSound: (nagSound) => update({ nagSound }),
    setShadeProminence: (shadeProminence) => update({ shadeProminence })
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within a SettingsProvider')
  return context
}
