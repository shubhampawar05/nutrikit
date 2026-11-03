// Renders the favicon.ico, app icons and og-image.png in web/public from the logo mark (same paths as
// web/src/components/Icon.tsx). Uses the Playwright browser installed by the e2e workspace:
//   npm run browsers -w e2e && PLAYWRIGHT_BROWSERS_PATH=0 node web/scripts/render-icons.mjs web/public
// The nutrition label on og-image.png shows real output of POST /v1/log/text for its meal.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const out = path.resolve(process.argv[2] || 'web/public');
const require = createRequire(path.join(out, '../../e2e/package.json'));
const { chromium } = require('playwright');

const INK = '#161513', PAPER = '#f7f2e8', RED = '#e0462b';
const mark = (lines) => `<path d="M5 3h12l6 6v16H5z" fill="${INK}"/><path d="M17 3v6h6z" fill="${RED}"/><path d="M9 13h10M9 17h10M9 21h6" stroke="${lines}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
// Plain mark (favicon.ico): transparent, filling the square.
const plain = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="2 1.5 24 24">${mark(PAPER)}</svg>`;
// Tile (app icons): the mark on paper. inset = share of the side left as padding on each edge.
const tile = (s, inset, radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${radius}" fill="${PAPER}"/>
  <g transform="translate(${inset} ${inset}) scale(${(100 - 2 * inset) / 24}) translate(-2 -1.5)">${mark(PAPER)}</g></svg>`;

const og = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&family=Inter:wght@500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box} body{width:1200px;height:630px;background:${PAPER};color:${INK};font-family:Inter,sans-serif;position:relative;overflow:hidden}
  .brand{position:absolute;top:64px;left:80px;display:flex;align-items:center;gap:14px;font:600 34px Inter}
  .brand svg{width:46px;height:46px}
  h1{position:absolute;top:170px;left:80px;width:620px;font:500 76px/1.04 Fraunces,serif;letter-spacing:-1.5px}
  h1 em{color:${RED};font-style:italic}
  p{position:absolute;top:440px;left:80px;width:600px;font:500 27px/1.4 Inter;color:#4a463f}
  .url{position:absolute;bottom:56px;left:80px;font:500 22px 'JetBrains Mono',monospace;color:#6b665c}
  .label{position:absolute;top:84px;right:80px;width:360px;background:#fff;border:3px solid ${INK};padding:20px 22px;font-family:Inter;transform:rotate(2deg);box-shadow:12px 12px 0 rgba(22,21,19,.12)}
  .label h2{font:800 34px Inter;letter-spacing:-.5px;border-bottom:10px solid ${INK};padding-bottom:6px}
  .row{display:flex;justify-content:space-between;font:600 20px Inter;border-bottom:1.5px solid ${INK};padding:9px 0}
  .row.big{font:800 30px Inter;border-bottom:6px solid ${INK}} .row span:last-child{font-weight:500}
  .sub{padding-left:20px}
</style></head><body>
<div class="brand"><svg viewBox="2 1.5 24 24">${mark(PAPER)}</svg>nutrikit</div>
<h1>Describe a meal. Get the <em>nutrition label</em>.</h1>
<p>Nutrition API for food search, meal logging, barcodes and labels.</p>
<div class="url">nutrikit.onrender.com</div>
<div class="label"><h2>Nutrition Facts</h2>
  <div class="row"><span>2 eggs, toast, coffee with milk</span><span></span></div>
  <div class="row big"><span>Calories</span><span>234</span></div>
  <div class="row"><span>Total Fat</span><span>11.7 g</span></div>
  <div class="row"><span>Protein</span><span>16.3 g</span></div>
  <div class="row"><span>Carbohydrate</span><span>15.9 g</span></div>
  <div class="row sub"><span>Fiber</span><span>0.6 g</span></div>
  <div class="row" style="border:0"><span>Sodium</span><span>270 mg</span></div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function svgToPng(svg, size, file, transparent) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const buf = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  if (file) fs.writeFileSync(path.join(out, file), buf);
  return buf;
}
await svgToPng(tile(180, 16, 0), 180, 'apple-touch-icon.png', false);    // iOS rounds the corners itself
await svgToPng(tile(192, 14, 22), 192, 'icon-192.png', true);
await svgToPng(tile(512, 14, 22), 512, 'icon-512.png', true);
await svgToPng(tile(512, 24, 0), 512, 'icon-maskable-512.png', false);  // safe zone: inner 80%

// favicon.ico: PNG-encoded 16, 32 and 48 px images (supported by every current browser).
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await svgToPng(plain(s), s, null, true));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(out, 'favicon.ico'), Buffer.concat([header, ...pngs]));

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
fs.writeFileSync(path.join(out, 'og-image.png'), await page.screenshot({ type: 'png' }));
await browser.close();
console.log('written to', out);
