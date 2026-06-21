/**
 * Catches render-time crashes and shows a clean recoverable fallback instead of
 * a blank screen. Transient/async errors surface via toasts (see lib/toast.ts);
 * this is the last resort for unexpected UI failures.
 */
import { Component, type ReactNode } from 'react'
import Box from '@mui/joy/Box'
import Sheet from '@mui/joy/Sheet'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error('Unhandled UI error', error)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Sheet variant="outlined" sx={{ p: 3, borderRadius: 'md', maxWidth: 420, textAlign: 'center' }}>
          <Typography level="title-lg" sx={{ mb: 1 }}>
            Something went wrong
          </Typography>
          <Typography level="body-sm" sx={{ mb: 2 }}>
            {this.state.error.message || 'An unexpected error occurred.'}
          </Typography>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Sheet>
      </Box>
    )
  }
}
