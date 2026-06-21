/**
 * Public app-release info. Proxies GitHub's "latest release" so the client can
 * check for updates same-origin (no CORS) and isn't subject to GitHub's
 * unauthenticated per-IP rate limit, which mobile/CGNAT networks routinely
 * exhaust. The result is cached in-memory briefly and served stale on failure.
 *
 * Intentionally unauthenticated: this is public release metadata, not a domain
 * row, so the per-user scoping rule does not apply.
 */
import { Router } from 'express'
import { logger } from '../lib/logger.js'

const REPO = 'RyanEwen/persistent'
const CACHE_MS = 10 * 60 * 1000

interface ReleaseInfo {
  version: string
  notes: string
  apkUrl: string
}

let cache: { at: number; data: ReleaseInfo | null } | null = null

export const appReleaseRouter = Router()

appReleaseRouter.get('/latest-release', async (_request, response) => {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) {
    response.json(cache.data)
    return
  }

  try {
    // GitHub's API rejects requests without a User-Agent (403); Node's fetch
    // doesn't set one by default.
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'persistent-app' }
    })
    if (r.status === 404) {
      cache = { at: now, data: null } // no releases published yet
      response.json(null)
      return
    }
    if (!r.ok) throw new Error(`GitHub responded ${r.status}`)

    const rel = (await r.json()) as {
      tag_name?: string
      body?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const apk = rel.assets?.find((a) => a.name?.endsWith('.apk'))
    const data: ReleaseInfo | null =
      apk?.browser_download_url && rel.tag_name
        ? { version: rel.tag_name.replace(/^v/, ''), notes: rel.body ?? '', apkUrl: apk.browser_download_url }
        : null

    cache = { at: now, data }
    response.json(data)
  } catch (error) {
    logger.warn('latest-release fetch failed', { error: String(error) })
    if (cache) {
      response.json(cache.data) // serve stale rather than failing the client
      return
    }
    response.status(502).json({ error: 'Could not fetch release info.' })
  }
})
