/** Identity of the HTML and assets loaded by this page, stamped at build time. */
export const WEB_BUILD_ID_META_NAME = 'persistent:web-build'

/** Unknown in development and older builds; unknown never means stale. */
export function readLocalWebBuildId(): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${WEB_BUILD_ID_META_NAME}"]`)?.content.trim() || null
}
