/**
 * Publishes a bounded, display-ready Upcoming snapshot to the Windows host.
 * The widget is deliberately read-only: selecting it returns to the hosted app,
 * where authentication and reminder actions already have one implementation.
 */
import { useEffect } from 'react'
import { reminderBodyText, type ReminderType } from '@persistent/shared'
import { useReminders } from '../data/reminders.js'
import { useActiveOccurrences } from '../data/occurrences.js'
import { formatWhen } from '../lib/datetime.js'
import { selectUpcomingReminders } from '../lib/upcomingReminders.js'
import { useSettings } from '../settings/useSettings.js'
import {
  isDesktopHost,
  onHostMessage,
  publishWidgetSnapshot,
  type WidgetSnapshot
} from './desktopBridge.js'

const WidgetItemLimit = 4

const TypeLabels: Record<ReminderType, string> = {
  NONE: 'REMINDER',
  TODO: 'TO-DO',
  MEDICATION: 'MEDICATION'
}

/** Convert full reminder DTOs into the only strings the native widget needs. */
function makeSnapshot(
  reminders: NonNullable<ReturnType<typeof useReminders>['data']>,
  active: NonNullable<ReturnType<typeof useActiveOccurrences>['data']>,
  timeFormat: ReturnType<typeof useSettings>['timeFormat']
): WidgetSnapshot {
  const items = selectUpcomingReminders(reminders, active)
    .slice(0, WidgetItemLimit)
    .map(({ reminder, next }) => ({
      type: TypeLabels[reminder.type],
      title: reminder.title,
      description: reminderBodyText(reminder),
      when: next ? formatWhen(next, timeFormat) : 'Paused',
      paused: !reminder.active
    }))

  return {
    version: 1,
    signedIn: true,
    generatedAt: new Date().toISOString(),
    items
  }
}

/** Keep the Windows widget cache current while the authenticated app is mounted. */
export function DesktopWidgetSync() {
  const reminders = useReminders()
  const active = useActiveOccurrences()
  const { timeFormat } = useSettings()
  const reminderData = reminders.data
  const activeData = active.data
  const refetchReminders = reminders.refetch
  const refetchActive = active.refetch

  useEffect(() => {
    if (!isDesktopHost() || !reminderData || !activeData) return
    publishWidgetSnapshot(makeSnapshot(reminderData, activeData, timeFormat))
  }, [activeData, reminderData, timeFormat])

  useEffect(
    () =>
      onHostMessage((message) => {
        if (message.type !== 'refreshWidgetSnapshot') return
        void (async () => {
          const [freshReminders, freshActive] = await Promise.all([refetchReminders(), refetchActive()])
          if (!freshReminders.data || !freshActive.data) return
          publishWidgetSnapshot(makeSnapshot(freshReminders.data, freshActive.data, timeFormat))
        })()
      }),
    [refetchActive, refetchReminders, timeFormat]
  )

  return null
}
