import { createContext, useContext } from 'react'

export interface ReminderDialogActions {
  view: (id: string) => void
  edit: (id: string) => void
  create: () => void
}

export const ReminderDialogContext = createContext<ReminderDialogActions | null>(null)

/** Open a reminder over the current screen without changing its route. */
export function useReminderDialogs(): ReminderDialogActions {
  const actions = useContext(ReminderDialogContext)
  if (!actions) throw new Error('Reminder dialogs are unavailable outside the app shell')
  return actions
}
