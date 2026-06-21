import { useCallback, useEffect, useRef, type ComponentProps } from 'react'
import Modal from '@mui/joy/Modal'

/**
 * Joy Modal wrapper that treats browser/Android Back as dialog dismissal.
 *
 * Each open dialog appends a token to a history-backed stack; Back closes the top
 * dialog instead of navigating the route, and a normal close pops the dialog's
 * history entry so a later Back performs normal navigation (and Forward can't
 * re-open it). Adapted from printstream's BackAwareModal.
 */
type BackAwareModalProps = ComponentProps<typeof Modal>
type BackAwareModalOnClose = NonNullable<BackAwareModalProps['onClose']>

const dialogHistoryStackStateKey = '__persistentDialogStack'

interface ActiveDialogEntry {
  token: string
  requestClose: () => void
}

let dialogHistoryTokenCounter = 0
let dialogHistoryListenerInstalled = false
const activeDialogEntries: ActiveDialogEntry[] = []
const dismissedDialogTokens = new Set<string>()
const closingDialogTokensFromHistory = new Set<string>()

function createDialogHistoryToken() {
  dialogHistoryTokenCounter += 1
  return `dialog-${dialogHistoryTokenCounter}`
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function readDialogHistoryStack(state: unknown): string[] {
  if (state == null || typeof state !== 'object') return []
  const stack = (state as Record<string, unknown>)[dialogHistoryStackStateKey]
  return isStringArray(stack) ? stack : []
}

function buildDialogHistoryState(stack: string[]) {
  const currentState = window.history.state
  const baseState = currentState != null && typeof currentState === 'object' ? (currentState as Record<string, unknown>) : {}
  return { ...baseState, [dialogHistoryStackStateKey]: stack }
}

function getActiveDialogStack() {
  return activeDialogEntries.map((entry) => entry.token)
}

function areDialogStacksEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function isDialogStackPrefix(prefix: string[], full: string[]) {
  return prefix.length <= full.length && prefix.every((entry, index) => entry === full[index])
}

function isTopHistoryDialog(token: string) {
  const stack = readDialogHistoryStack(window.history.state)
  return stack[stack.length - 1] === token
}

function replaceCurrentDialogHistoryWithActiveStack() {
  window.history.replaceState(buildDialogHistoryState(getActiveDialogStack()), document.title)
}

function registerActiveDialog(token: string, requestClose: () => void) {
  const existingEntry = activeDialogEntries.find((entry) => entry.token === token)
  if (existingEntry) {
    existingEntry.requestClose = requestClose
    return false
  }
  activeDialogEntries.push({ token, requestClose })
  return true
}

function unregisterActiveDialog(token: string) {
  const entryIndex = activeDialogEntries.findIndex((entry) => entry.token === token)
  if (entryIndex === -1) return false
  activeDialogEntries.splice(entryIndex, 1)
  return true
}

function handleDialogHistoryPopState(event: PopStateEvent) {
  const nextStack = readDialogHistoryStack(event.state)
  const currentStack = getActiveDialogStack()
  if (areDialogStacksEqual(nextStack, currentStack)) return

  if (isDialogStackPrefix(nextStack, currentStack)) {
    const dialogsToClose = activeDialogEntries.slice(nextStack.length).reverse()
    dialogsToClose.forEach((entry) => {
      dismissedDialogTokens.add(entry.token)
      closingDialogTokensFromHistory.add(entry.token)
      entry.requestClose()
    })
    return
  }

  const isStaleDialogEntry =
    nextStack.some((token) => dismissedDialogTokens.has(token)) || !isDialogStackPrefix(currentStack, nextStack)
  if (!isStaleDialogEntry) return

  queueMicrotask(() => {
    replaceCurrentDialogHistoryWithActiveStack()
    if (window.history.length > 1) window.history.back()
  })
}

function installDialogHistoryListener() {
  if (dialogHistoryListenerInstalled) return
  window.addEventListener('popstate', handleDialogHistoryPopState)
  dialogHistoryListenerInstalled = true
}

export function BackAwareModal({ open, onClose, ...props }: BackAwareModalProps) {
  const previousOpenRef = useRef(open)
  const onCloseRef = useRef(onClose)
  const dialogTokenRef = useRef<string | null>(null)

  onCloseRef.current = onClose

  const requestClose = useCallback(() => {
    onCloseRef.current?.({}, 'backdropClick')
  }, [])

  const syncClosedDialog = useCallback((token: string, closeViaHistory: boolean) => {
    const closedFromHistory = closingDialogTokensFromHistory.delete(token)
    dismissedDialogTokens.add(token)
    unregisterActiveDialog(token)
    dialogTokenRef.current = null
    if (!closedFromHistory && closeViaHistory && isTopHistoryDialog(token) && window.history.length > 1) {
      window.history.back()
    }
  }, [])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    installDialogHistoryListener()
    const dialogToken = dialogTokenRef.current ?? createDialogHistoryToken()
    dialogTokenRef.current = dialogToken
    const didRegister = registerActiveDialog(dialogToken, requestClose)
    if (didRegister) {
      window.history.pushState(buildDialogHistoryState(getActiveDialogStack()), document.title)
    }
  }, [open, requestClose])

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open
    if (open || !wasOpen || typeof window === 'undefined') return
    const dialogToken = dialogTokenRef.current
    if (dialogToken) syncClosedDialog(dialogToken, true)
  }, [open, syncClosedDialog])

  useEffect(() => {
    return () => {
      const dialogToken = dialogTokenRef.current
      if (!dialogToken) return
      closingDialogTokensFromHistory.delete(dialogToken)
      dismissedDialogTokens.add(dialogToken)
      unregisterActiveDialog(dialogToken)
      dialogTokenRef.current = null
    }
  }, [])

  const handleClose = useCallback<BackAwareModalOnClose>((event, reason) => {
    const dialogToken = dialogTokenRef.current
    if (!dialogToken || typeof window === 'undefined') {
      onCloseRef.current?.(event, reason)
      return
    }
    dismissedDialogTokens.add(dialogToken)
    if (isTopHistoryDialog(dialogToken) && window.history.length > 1) {
      window.history.back()
      return
    }
    onCloseRef.current?.(event, reason)
  }, [])

  return <Modal open={open} onClose={handleClose} {...props} />
}
