/**
 * Lightweight app-wide toast. Call `useToast()` to get a `toast(message, color?)`
 * function; it shows a brief Joy Snackbar. Lives above the router so a toast
 * fired right before navigation (e.g. "Saved" then close the editor) still shows.
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import Snackbar from '@mui/joy/Snackbar'
import { setToastHandler } from '../lib/toast.js'

type ToastColor = 'success' | 'danger' | 'neutral'
type ShowToast = (message: string, color?: ToastColor) => void

const ToastContext = createContext<ShowToast>(() => {})

export function useToast(): ShowToast {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [color, setColor] = useState<ToastColor>('success')

  const show = useCallback<ShowToast>((msg, c = 'success') => {
    setMessage(msg)
    setColor(c)
    setOpen(true)
  }, [])

  // Let non-React code (e.g. the query client) raise toasts too.
  useEffect(() => {
    setToastHandler(show)
    return () => setToastHandler(null)
  }, [show])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        open={open}
        onClose={() => setOpen(false)}
        autoHideDuration={2500}
        color={color}
        variant="soft"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: 9 }} // clear the bottom nav
      >
        {message}
      </Snackbar>
    </ToastContext.Provider>
  )
}
