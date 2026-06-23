/**
 * gen-icons.mjs — rasterize the app-icon SVG sources into Android launcher PNGs.
 *
 * Source of truth is `assets/*.svg` (hand-authored); this script renders them
 * into `android-res/mipmap-<dpi>/` at every density, which `setup-android.mjs`
 * then overlays onto the generated Capacitor project. Run after editing an SVG.
 *
 * Rasterizer is rsvg-convert (librsvg) — ImageMagick's built-in SVG renderer
 * does not antialias and produces jagged edges. librsvg ships in the devcontainer
 * image (.devcontainer/Dockerfile); install `librsvg2-bin` if running elsewhere.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(mobileRoot, 'assets')
const resRoot = join(mobileRoot, 'android-res')

// density bucket -> scale factor relative to the base (mdpi) size in dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

// each icon: SVG source -> output PNG name, with its base size in dp. Legacy +
// round launcher icons are 48dp; the adaptive foreground is 108dp.
const ICONS = [
  { src: 'icon-legacy.svg', out: 'ic_launcher.png', baseDp: 48 },
  { src: 'icon-round.svg', out: 'ic_launcher_round.png', baseDp: 48 },
  { src: 'icon-foreground.svg', out: 'ic_launcher_foreground.png', baseDp: 108 },
]

function assertRsvg() {
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' })
  } catch {
    console.error(
      '[gen-icons] rsvg-convert not found. Install it with `apt-get install librsvg2-bin`\n' +
        '            (it is preinstalled in the devcontainer image).',
    )
    process.exit(1)
  }
}

assertRsvg()

let count = 0
for (const [density, factor] of Object.entries(DENSITIES)) {
  const outDir = join(resRoot, `mipmap-${density}`)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  for (const { src, out, baseDp } of ICONS) {
    const srcPath = join(assets, src)
    if (!existsSync(srcPath)) {
      console.error(`[gen-icons] missing source ${srcPath}`)
      process.exit(1)
    }
    const px = Math.round(baseDp * factor)
    execFileSync('rsvg-convert', [
      '-w', String(px),
      '-h', String(px),
      srcPath,
      '-o', join(outDir, out),
    ])
    count++
  }
}

console.log(`[gen-icons] wrote ${count} PNGs across ${Object.keys(DENSITIES).length} densities`)
