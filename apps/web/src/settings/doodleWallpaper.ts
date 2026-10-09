/** Stable, irregular doodle wallpaper with balanced spacing across tile boundaries. */
const GLYPHS: Record<string, string> = {
  clock: `<circle cx='0' cy='0' r='10'/><path d='M0 0 V-7 M0 0 H6'/>`,
  bell: `<path d='M-8 8 C-8 2 -7 -8 0 -8 C7 -8 8 2 8 8 Z'/><path d='M0 -8 V-11'/><path d='M-3 8 a3 3 0 0 0 6 0'/>`,
  pill: `<rect x='-12' y='-5.5' width='24' height='11' rx='5.5'/><path d='M0 -5.5 V5.5'/>`,
  check: `<circle cx='0' cy='0' r='10'/><path d='M-5 0 l3 3 l6 -7'/>`,
  calendar: `<rect x='-13' y='-10' width='26' height='22' rx='3'/><path d='M-13 -3 H13 M-6 -14 V-8 M6 -14 V-8'/>`
}

const TILE = 468
export const DOODLE_TILE_CSS_SIZE = 312

// A fixed best-candidate distribution considers neighbors across opposite edges.
// The larger tile avoids repeating columns; glyph size and overall density stay
// the same as the original wallpaper. Centers are at least 40 SVG pixels apart.
// Neighboring centers within 78 pixels use different glyphs, including at seams.
const PLACEMENTS: [keyof typeof GLYPHS, number, number, number][] = [
  ['clock', 369, 35, -13],
  ['calendar', 135, 266, -17],
  ['bell', 362, 266, 3],
  ['calendar', 140, 37, 8],
  ['bell', 21, 396, -12],
  ['calendar', 8, 155, 5],
  ['pill', 255, 374, -18],
  ['pill', 250, 167, -23],
  ['clock', 377, 377, -11],
  ['clock', 141, 379, -5],
  ['pill', 132, 153, 27],
  ['check', 20, 270, -19],
  ['calendar', 242, 11, -13],
  ['calendar', 364, 158, -17],
  ['calendar', 35, 38, 14],
  ['clock', 233, 286, 7],
  ['pill', 289, 90, -3],
  ['pill', 312, 433, 28],
  ['bell', 206, 90, 3],
  ['calendar', 75, 329, 6],
  ['bell', 78, 206, 11],
  ['bell', 425, 96, -15],
  ['clock', 422, 212, -5],
  ['bell', 434, 459, -6],
  ['clock', 296, 226, -4],
  ['bell', 89, 92, 4],
  ['calendar', 89, 435, 12],
  ['bell', 191, 220, -2],
  ['clock', 429, 315, 9],
  ['bell', 197, 424, 10],
  ['calendar', 320, 332, -12],
  ['bell', 200, 341, 8],
  ['check', 348, 96, -10],
  ['check', 377, 436, -20],
  ['pill', 17, 336, -25],
  ['clock', 15, 92, -2],
  ['bell', 311, 24, 7],
  ['clock', 76, 261, 13],
  ['pill', 301, 280, -36],
  ['check', 188, 145, 13],
  ['check', 436, 379, 15],
  ['pill', 142, 449, -17],
  ['bell', 311, 145, 11],
  ['pill', 22, 213, -29],
  ['check', 60, 147, -1],
  ['check', 73, 384, 13],
  ['clock', 189, 14, 19],
  ['check', 144, 324, -14],
  ['clock', 144, 96, -1],
  ['check', 421, 159, 15],
  ['clock', 134, 207, 6],
  ['pill', 373, 322, -38],
  ['check', 30, 450, 19],
  ['calendar', 414, 264, -1],
  ['check', 453, 51, 1],
  ['bell', 304, 385, -14],
  ['clock', 85, 26, 19],
  ['check', 243, 233, -2],
  ['pill', 348, 208, 5],
  ['pill', 181, 288, -1],
  ['bell', 453, 243, 10],
  ['check', 251, 61, -8],
  ['clock', 245, 423, 9],
  ['calendar', 245, 119, -4],
  ['check', 257, 328, -16],
  ['calendar', 411, 53, -12],
  ['pill', 52, 75, -7],
  ['pill', 178, 54, -1],
  ['calendar', 216, 387, -10],
  ['clock', 454, 420, 16],
  ['calendar', 409, 411, -9],
  ['calendar', 344, 460, 0],
]

/** Draw edge-crossing glyphs in neighboring tiles so no doodle is cut at a seam. */
function glyphCopies(name: keyof typeof GLYPHS, x: number, y: number, rotation: number): string {
  const copies: string[] = []
  const edgePadding = 20

  for (const offsetX of [-TILE, 0, TILE]) {
    for (const offsetY of [-TILE, 0, TILE]) {
      const copyX = x + offsetX
      const copyY = y + offsetY
      if (copyX < -edgePadding || copyX > TILE + edgePadding || copyY < -edgePadding || copyY > TILE + edgePadding) {
        continue
      }
      copies.push(`<g transform='translate(${copyX} ${copyY}) rotate(${rotation})'>${GLYPHS[name]}</g>`)
    }
  }
  return copies.join('')
}

/** A seamless SVG tile, with fixed positions and subdued ink, encoded as a CSS url(). */
export function doodleTile(color: string): string {
  const body = PLACEMENTS.map(([name, x, y, rotation]) => glyphCopies(name, x, y, rotation)).join('')
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}' viewBox='0 0 ${TILE} ${TILE}' ` +
    `fill='none' stroke='${color}' stroke-opacity='0.45' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>` +
    body +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
