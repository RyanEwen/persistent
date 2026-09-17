/**
 * Reloads only when the served web build differs from the page already loaded.
 * Worker activation and wake-up checks share this policy. Unknown/offline answers
 * leave the page alone; one recorded attempt per target prevents reload loops.
 */
import { readLocalWebBuildId } from './webBuildId'

interface UpdateEnvironment {
  localBuildId: () => string | null
  servedBuildId: () => Promise<string | null>
  storage: () => Storage
  reload: () => void
}

/** Own one page's update checks, coalescing concurrent signals and reload attempts. */
export function createWebUpdateChecker(environment: UpdateEnvironment): () => Promise<void> {
  let checking: Promise<void> | null = null
  let reloading = false
  const attemptKey = 'persistent:web-reload-target'

  async function check(): Promise<void> {
    const local = environment.localBuildId()
    if (!local || reloading) return
    try {
      const target = await environment.servedBuildId()
      if (!target) return
      const storage = environment.storage()
      if (target === local) {
        storage.removeItem(attemptKey)
        return
      }
      if (storage.getItem(attemptKey) === target) return
      // If storage is unavailable, a reload could loop. Leave the page usable.
      storage.setItem(attemptKey, target)
      reloading = true
      environment.reload()
    } catch {
      // Offline or blocked storage is not evidence that this page needs a refresh.
    }
  }

  return async () => {
    if (!checking) checking = check()
    try {
      await checking
    } finally {
      checking = null
    }
  }
}

/** Read a fresh build identity; this static probe must never enter the precache. */
async function fetchServedBuildId(): Promise<string | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}build-id.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) return null
  const body = await response.json() as { buildId?: unknown }
  return typeof body.buildId === 'string' ? body.buildId.trim() || null : null
}

export const checkForWebUpdate = createWebUpdateChecker({
  localBuildId: readLocalWebBuildId,
  servedBuildId: fetchServedBuildId,
  storage: () => window.sessionStorage,
  reload: () => window.location.reload()
})
