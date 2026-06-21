/**
 * Pull-to-refresh for the page lists. When the window is scrolled to the top and
 * the user drags down, it shows a spinner and runs onRefresh (refetch). Works on
 * touch (native app + mobile web); a no-op interaction on desktop.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Box from '@mui/joy/Box'
import CircularProgress from '@mui/joy/CircularProgress'

const MAX_PULL = 90
const TRIGGER = 64
const SPINNER_AT = 48

export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // pull/refreshing live in refs too so the native (non-passive) listeners see fresh values.
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  pullRef.current = pull
  refreshingRef.current = refreshing

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      if (window.scrollY > 0) {
        startY.current = null
        return
      }
      startY.current = e.touches[0]?.clientY ?? null
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshingRef.current) return
      const y = e.touches[0]?.clientY ?? 0
      const delta = y - startY.current
      if (delta <= 0 || window.scrollY > 0) {
        if (pullRef.current !== 0) setPull(0)
        return
      }
      e.preventDefault() // take over from native scroll/overscroll
      setPull(Math.min(delta * 0.5, MAX_PULL))
    }
    const onEnd = () => {
      if (startY.current === null) return
      startY.current = null
      if (pullRef.current >= TRIGGER && !refreshingRef.current) {
        setRefreshing(true)
        setPull(SPINNER_AT)
        Promise.resolve(onRefresh())
          .catch(() => {})
          .finally(() => {
            setRefreshing(false)
            setPull(0)
          })
      } else {
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  const progress = Math.min(100, (pull / TRIGGER) * 100)

  return (
    <Box ref={ref} sx={{ position: 'relative' }}>
      <Box
        sx={{
          position: 'absolute',
          top: -44,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          transform: `translateY(${pull}px)`,
          transition: pull === 0 ? 'transform 0.2s ease' : 'none',
          pointerEvents: 'none',
          opacity: pull > 4 || refreshing ? 1 : 0
        }}
      >
        <CircularProgress
          size="sm"
          determinate={!refreshing}
          value={refreshing ? undefined : progress}
        />
      </Box>
      <Box
        sx={{
          transform: `translateY(${pull}px)`,
          transition: pull === 0 ? 'transform 0.2s ease' : 'none'
        }}
      >
        {children}
      </Box>
    </Box>
  )
}
