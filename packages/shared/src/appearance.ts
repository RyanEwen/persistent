/** Display-only palette mirrored to native surfaces, without reminder or account data. */
import { z } from 'zod'

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const nativePaletteSchema = z.object({
  background: color,
  surface: color,
  surfacePressed: color,
  text: color,
  secondary: color,
  border: color,
  accent: color,
  accentPressed: color,
  onAccent: color,
  kicker: color,
  done: color,
  donePressed: color,
  onDone: color
})
export const nativeAppearanceSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['system', 'light', 'dark']),
  light: nativePaletteSchema,
  dark: nativePaletteSchema
})
export type NativePalette = z.infer<typeof nativePaletteSchema>
export type NativeAppearance = z.infer<typeof nativeAppearanceSchema>
