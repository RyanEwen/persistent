/** Generate reusable marketing layouts around captured UI; never synthesize app content. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

interface PlayShot { file: string; source: string; headline: string; caption: string; theme: string }
const manifest = JSON.parse(readFileSync('store-assets/manifest.json', 'utf8')) as { play: PlayShot[]; microsoft: Array<{ file: string; alt: string }> }

/** Escape captions and relative asset paths before inserting them into static HTML. */
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

mkdirSync('store-assets/render', { recursive: true })
for (const [index, shot] of manifest.play.entries()) {
  const angle = index % 2 === 0 ? -2 : 2
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Persistent store composition</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; width: 720px; height: 1280px; overflow: hidden; }
body { background: #e7edf3 url('../marketing/studio-background.png') center/cover; color: #26384a; font-family: Arial, sans-serif; }
.copy { position: absolute; top: 46px; left: 60px; right: 60px; z-index: 2; }
h1 { white-space: pre-line; margin: 0; font-size: 48px; line-height: 1.06; letter-spacing: -1.5px; max-width: 610px; }
p { margin: 15px 0 0; color: #52677b; font-size: 22px; line-height: 1.35; }
.phone { position: absolute; width: 460px; height: 1002px; left: 130px; top: 216px;
  padding: 17px 10px 10px; border-radius: 46px; transform: rotate(${angle}deg);
  background: linear-gradient(110deg,#626974,#10151b 12%,#131920 88%,#75808c);
  border: 2px solid #6e7985; box-shadow: 22px 26px 40px #253b5b45, 4px 6px 8px #182d4b35, inset 0 0 0 3px #a2acb930; }
.phone:before { content: ''; position: absolute; height: 3px; width: 62px; border-radius: 8px; top: 7px; left: 197px; background: #111820; }
.screen { width: 100%; height: 100%; overflow: hidden; border-radius: 30px; background: ${shot.theme === 'enjoy-dark' ? '#191a1d' : '#fafaf9'}; }
img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
<div class="copy"><h1>${escape(shot.headline)}</h1><p>${escape(shot.caption)}</p></div>
<div class="phone"><div class="screen"><img src="../${escape(shot.source)}" alt="Captured Persistent app screen"></div></div>
</html>`
  const name = shot.file.split('/').at(-1)!.replace(/\.png$/, '.html')
  writeFileSync(`store-assets/render/${name}`, html)
  console.log(`Render in Paseo at 720x1280 CSS pixels: store-assets/render/${name}`)
}

// A review sheet gives the whole refresh a stable, easy-to-share visual overview.
const review = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Persistent store refresh</title>
<style>
* { box-sizing: border-box; } body { margin: 0; padding: 28px; width: 1440px; height: 730px; background: #eef0f2; color: #26384a; font: 16px Arial, sans-serif; }
h1 { font-size: 26px; margin: 0 0 16px; } h2 { font-size: 20px; margin: 20px 0 12px; }
.play { display: grid; grid-template-columns: repeat(${manifest.play.length},1fr); gap: 14px; }
.desktop { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; }
figure { margin: 0; } img { width: 100%; display: block; border-radius: 6px; }
.play img { height: 390px; object-fit: contain; } .desktop img { height: 178px; object-fit: contain; }
</style><h1>Persistent: Google Play carousel</h1><div class="play">
${manifest.play.map((shot) => `<figure><img src="../${escape(shot.file)}" alt="${escape(shot.headline)}"></figure>`).join('')}
</div><h2>Microsoft Store: native Windows tray flyout</h2><div class="desktop">
${manifest.microsoft.map((shot) => `<figure><img src="../${escape(shot.file)}" alt="${escape(shot.alt)}"></figure>`).join('')}
</div></html>`
writeFileSync('store-assets/render/review.html', review)
