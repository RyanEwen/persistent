/**
 * Client-side display preferences (persisted to localStorage). Currently the
 * 12h/24h time format used by lib/datetime.ts. These are per-device UI prefs,
 * not server-synced account settings.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { detectTimeFormat, type TimeFormat } from '../lib/datetime.js'

const STORAGE_KEY = 'persistent-settings'

interface Settings {
  timeFormat: TimeFormat
}

interface SettingsContextValue extends Settings {
  setTimeFormat: (format: TimeFormat) => void
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      if (parsed.timeFormat === '12h' || parsed.timeFormat === '24h') {
        return { timeFormat: parsed.timeFormat }
      }
    }
  } catch {
    /* fall through to the detected default */
  }
  return { timeFormat: detectTimeFormat() }
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  function setTimeFormat(timeFormat: TimeFormat) {
    setSettings((prev) => {
      const next = { ...prev, timeFormat }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore persistence failures (e.g. private mode) */
      }
      return next
    })
  }

  return <SettingsContext.Provider value={{ ...settings, setTimeFormat }}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within a SettingsProvider')
  return context
}
