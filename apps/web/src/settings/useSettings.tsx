/**
 * Client-side display preferences (persisted to localStorage). Currently the
 * 12h/24h time format used by lib/datetime.ts. These are per-device UI prefs,
 * not server-synced account settings.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { detectTimeFormat, type TimeFormat } from '../lib/datetime.js'
import { APP_THEMES, DEFAULT_THEME_ID, type ThemeId } from './themes.js'

const STORAGE_KEY = 'persistent-settings'

interface Settings {
  timeFormat: TimeFormat
  themeId: ThemeId
}

interface SettingsContextValue extends Settings {
  setTimeFormat: (format: TimeFormat) => void
  setThemeId: (id: ThemeId) => void
}

function loadSettings(): Settings {
  const defaults: Settings = { timeFormat: detectTimeFormat(), themeId: DEFAULT_THEME_ID }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return {
        timeFormat: parsed.timeFormat === '12h' || parsed.timeFormat === '24h' ? parsed.timeFormat : defaults.timeFormat,
        themeId: APP_THEMES.some((t) => t.id === parsed.themeId) ? (parsed.themeId as ThemeId) : defaults.themeId
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  function update(patch: Partial<Settings>) {
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
    setTimeFormat: (timeFormat) => update({ timeFormat }),
    setThemeId: (themeId) => update({ themeId })
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within a SettingsProvider')
  return context
}
