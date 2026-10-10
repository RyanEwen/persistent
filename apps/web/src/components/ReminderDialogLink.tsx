/** Convert notification and saved reminder URLs into the same dialogs as list taps. */
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useReminderDialogs } from './reminderDialogContext.js'

/** Replace the deep link with Current so closing or Back leaves a usable list. */
export function ReminderDialogLink({ kind }: { kind: 'view' | 'edit' | 'new' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const dialogs = useReminderDialogs()

  useEffect(() => {
    navigate('/', { replace: true })

    if (kind === 'new') {
      dialogs.create()
    } else if (id && kind === 'edit') {
      dialogs.edit(id)
    } else if (id) {
      dialogs.view(id)
    }
  }, [kind, id, navigate, dialogs])

  return null
}
