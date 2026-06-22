/* eslint-disable no-undef */
/**
 * Web Push service-worker handler, imported into the generated Workbox SW.
 *
 * Best-effort persistence on the web (the hard guarantee lives in the native
 * Android app): notifications are shown with requireInteraction, and PERSISTENT/
 * ALARM reminders are re-shown if the user dismisses them without confirming.
 * An explicit Done/Snooze action (or a server `dismiss` push) clears them.
 *
 * The native client never receives these (it uses FCM data messages + on-device
 * alarms), so this file is web-only.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }

  if (payload.type === 'dismiss') {
    event.waitUntil(closeByTag(payload.occurrenceId))
    return
  }

  if (payload.type === 'silence') {
    // Escalation silenced elsewhere: re-show as a plain (non-escalated) nag — it
    // still nags (persistent re-show + requireInteraction), just without the alarm
    // framing or the Silence action.
    event.waitUntil(showReminder({ ...payload, type: 'fire', alarm: false, escalate: false, persistent: true }))
    return
  }

  if (payload.type === 'fire' || payload.type === 'escalate') {
    event.waitUntil(showReminder(payload))
  }
})

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  const action = event.action
  event.notification.close()

  if (action === 'done' && data.occurrenceId) {
    event.waitUntil(ack(data.occurrenceId).then(() => focusApp()))
    return
  }
  if (action === 'snooze' && data.occurrenceId) {
    event.waitUntil(snooze(data.occurrenceId, 10).then(() => focusApp()))
    return
  }
  if (action === 'silence' && data.occurrenceId) {
    // Stop the alarm but keep nagging — don't focus the app, like Done's two-tap.
    event.waitUntil(silence(data.occurrenceId))
    return
  }
  event.waitUntil(focusApp())
})

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {}
  // Re-show persistent/alarm reminders the user swiped away without confirming.
  // Programmatic close() (ack/dismiss) does NOT fire this event, so we won't loop.
  if (data.persistent) {
    self.registration.showNotification(event.notification.title, buildOptions(data))
  }
})

function showReminder(payload) {
  const data = {
    occurrenceId: payload.occurrenceId,
    reminderId: payload.reminderId,
    persistent:
      payload.persistent === true ||
      payload.alarm === true ||
      payload.escalate === true ||
      payload.type === 'escalate',
    // An escalation offers "Silence" (stop the alarm, keep nagging).
    escalated: payload.type === 'escalate' || payload.escalate === true,
    body: payload.body || ''
  }
  return self.registration.showNotification(payload.title || 'Reminder', buildOptions(data, payload))
}

function buildOptions(data, payload) {
  const actions = [
    { action: 'done', title: 'Done' },
    { action: 'snooze', title: 'Snooze 10m' }
  ]
  if (data.escalated) actions.push({ action: 'silence', title: 'Silence' })
  return {
    tag: data.occurrenceId,
    body: data.body || (payload && payload.body) || '',
    requireInteraction: true,
    renotify: true,
    data,
    actions
  }
}

function closeByTag(tag) {
  return self.registration.getNotifications({ tag }).then((list) => {
    list.forEach((notification) => notification.close())
  })
}

function ack(occurrenceId) {
  return fetch(`/api/occurrences/${occurrenceId}/ack`, { method: 'POST', credentials: 'include' }).catch(() => {})
}

function snooze(occurrenceId, minutes) {
  return fetch(`/api/occurrences/${occurrenceId}/snooze`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ minutes })
  }).catch(() => {})
}

function silence(occurrenceId) {
  return fetch(`/api/occurrences/${occurrenceId}/silence`, { method: 'POST', credentials: 'include' }).catch(() => {})
}

function focusApp() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) return client.focus()
    }
    return self.clients.openWindow('/')
  })
}
