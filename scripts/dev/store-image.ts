/** Validate store PNG exports before copying them into an upload directory. */
// Reuse the publisher's PNG reader so capture and upload validation cannot drift.
// @ts-expect-error - the existing Node publisher is a plain .mjs module.
import { pngSize } from '../../apps/mobile/scripts/play-publish.mjs'

/** Read an RGB PNG header; reject truncation, other formats, alpha, and oversized exports. */
export function inspectStorePng(bytes: Buffer): { width: number; height: number } {
  const dimensions = pngSize(bytes) as { width: number; height: number } | null
  if (bytes.length < 33 || !dimensions
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Expected a PNG with a complete IHDR header.')
  }
  if (bytes[24] !== 8 || bytes[25] !== 2) throw new Error('Export an 8-bit RGB PNG without alpha.')
  if (bytes.length > 50 * 1024 * 1024) throw new Error('PNG exceeds the 50 MB desktop limit.')
  const { width, height } = dimensions
  if (width === 0 || height === 0) throw new Error('PNG dimensions must be positive.')
  return { width, height }
}

/** Apply the fixed carousel dimensions and minimum native desktop dimensions. */
export function validateStoreImage(bytes: Buffer, store: 'play' | 'microsoft'): { width: number; height: number } {
  const dimensions = inspectStorePng(bytes)
  const { width, height } = dimensions
  if (store === 'play' && (width !== 1080 || height !== 1920)) throw new Error('Expected 1080x1920 for the Play carousel.')
  if (store === 'microsoft' && (width < 1366 || height < 768)) throw new Error('Below the desktop screenshot minimum.')
  return dimensions
}
