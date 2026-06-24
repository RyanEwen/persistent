/**
 * Client-side display preferences (persisted to localStorage). Currently the
 * 12h/24h time format used by lib/datetime.ts. These are per-device UI prefs,
 * not server-synced account settings.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { detectTimeFormat, type TimeFormat } from '../lib/datetime.js'
import { APP_THEMES, DEFAULT_THEME_ID, type ThemeId } from './themes.js'

const STORAGE_KEY = 'persistent-settings'

export interface SoundChoice {
  uri: string // '' = system default
  title: string
}

/** Device default for where reminders sit in the Android shade (visual only). */
export type ShadeDefault = 'NORMAL' | 'MINIMIZED'

interface Settings {
  timeFormat: TimeFormat
  themeId: ThemeId
  alarmSound: SoundChoice
  notificationSound: SoundChoice
  shadeProminence: ShadeDefault
}

/**
 * Persisted state. `timeFormat` is only stored once the user explicitly picks
 * one; until then we re-detect from the locale on every load (so a corrected
 * detection takes effect and isn't pinned by an earlier auto-captured value).
 */
interface StoredState extends Settings {
  timeFormatChosen: boolean
}

interface SettingsContextValue extends Settings {
  setTimeFormat: (format: TimeFormat) => void
  setThemeId: (id: ThemeId) => void
  setAlarmSound: (sound: SoundChoice) => void
  setNotificationSound: (sound: SoundChoice) => void
  setShadeProminence: (prominence: ShadeDefault) => void
}

const DEFAULT_SOUND: SoundChoice = { uri: '', title: 'Default' }

function toSound(value: unknown): SoundChoice {
  if (value && typeof value === 'object' && 'uri' in value && typeof (value as SoundChoice).uri === 'string') {
    const v = value as SoundChoice
    return { uri: v.uri, title: typeof v.title === 'string' && v.title ? v.title : 'Default' }
  }
  return DEFAULT_SOUND
}

function loadSettings(): StoredState {
  const defaults: StoredState = {
    timeFormat: detectTimeFormat(),
    timeFormatChosen: false,
    themeId: DEFAULT_THEME_ID,
    alarmSound: DEFAULT_SOUND,
    notificationSound: DEFAULT_SOUND,
    shadeProminence: 'NORMAL'
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>
      const chosen =
        parsed.timeFormatChosen === true && (parsed.timeFormat === '12h' || parsed.timeFormat === '24h')
      return {
        // Honor an explicit choice; otherwise re-detect (ignores values that were
        // auto-captured by an unrelated setting change).
        timeFormat: chosen ? (parsed.timeFormat as TimeFormat) : defaults.timeFormat,
        timeFormatChosen: chosen,
        themeId: APP_THEMES.some((t) => t.id === parsed.themeId) ? (parsed.themeId as ThemeId) : defaults.themeId,
        alarmSound: toSound(parsed.alarmSound),
        notificationSound: toSound(parsed.notificationSound),
        shadeProminence: parsed.shadeProminence === 'MINIMIZED' ? 'MINIMIZED' : 'NORMAL'
      }
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
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore persistence failures (e.g. private mode) */
      }
      return next
    })
  }

  const value: SettingsContextValue = {
    ...settings,
    setTimeFormat: (timeFormat) => update({ timeFormat, timeFormatChosen: true }),
    setThemeId: (themeId) => update({ themeId }),
    setAlarmSound: (alarmSound) => update({ alarmSound }),
    setNotificationSound: (notificationSound) => update({ notificationSound }),
    setShadeProminence: (shadeProminence) => update({ shadeProminence })
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within a SettingsProvider')
  return context
}
