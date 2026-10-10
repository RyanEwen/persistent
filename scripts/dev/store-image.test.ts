/** Store exports must reject bad encoding and dimensions before publication. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectStorePng, validateStoreImage } from './store-image.ts'

/** Construct just the PNG header to exercise metadata policy without image rendering. */
function header(width: number, height: number, colorType = 2): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = colorType
  return bytes
}

test('store exports reject truncated input, alpha and zero dimensions', () => {
  assert.throws(() => inspectStorePng(Buffer.alloc(20)), /complete IHDR/)
  assert.throws(() => inspectStorePng(header(1080, 1920, 6)), /without alpha/)
  assert.throws(() => inspectStorePng(header(0, 1920)), /positive/)
})

test('raw phone shots are not accepted as carousel exports', () => {
  assert.throws(() => validateStoreImage(header(672, 1497), 'play'), /1080x1920/)
  assert.deepEqual(validateStoreImage(header(1080, 1920), 'play'), { width: 1080, height: 1920 })
})

test('desktop captures meet both minimum dimensions', () => {
  assert.throws(() => validateStoreImage(header(1920, 767), 'microsoft'), /minimum/)
  assert.throws(() => validateStoreImage(header(1365, 1080), 'microsoft'), /minimum/)
  assert.deepEqual(validateStoreImage(header(1920, 1080), 'microsoft'), { width: 1920, height: 1080 })
})
