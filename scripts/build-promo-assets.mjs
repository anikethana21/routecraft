/**
 * Generates optional Chrome Web Store promotional tiles.
 *
 *   node scripts/build-promo-assets.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = resolve(root, 'store-assets');
mkdirSync(out, { recursive: true });

const logo = `data:image/png;base64,${readFileSync(resolve(root, 'public', 'icons', 'icon128.png')).toString('base64')}`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; }
  body {
    display: grid;
    place-items: center;
    overflow: hidden;
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #171126;
    background:
      radial-gradient(circle at 12% 18%, rgba(109, 58, 237, 0.18), transparent 34%),
      radial-gradient(circle at 88% 84%, rgba(46, 26, 87, 0.12), transparent 36%),
      linear-gradient(135deg, #faf8ff 0%, #f0eaff 55%, #f7f5ff 100%);
  }
  .grid {
    position: absolute; inset: 0; opacity: .5;
    background-image: linear-gradient(rgba(109,58,237,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(109,58,237,.07) 1px, transparent 1px);
    background-size: 4.5vw 4.5vw;
    mask-image: radial-gradient(circle at 50% 45%, black, transparent 78%);
  }
  .wrap { position: relative; display: flex; align-items: center; gap: 4.5vw; padding: 6vw; width: 100%; }
  .mark {
    width: 15vw; height: 15vw; min-width: 66px; min-height: 66px;
    border-radius: 3.2vw;
    box-shadow: 0 1.4vw 3vw rgba(46, 26, 87, .32);
    flex: none;
    object-fit: cover;
  }
  .copy { min-width: 0; }
  .eyebrow { font-size: clamp(10px, 1.4vw, 19px); font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #6d3aed; margin-bottom: 1.1vw; }
  h1 { margin: 0; font-size: clamp(27px, 5.3vw, 72px); line-height: 1.02; letter-spacing: -.045em; font-weight: 800; }
  p { margin: 1.5vw 0 0; font-size: clamp(12px, 1.85vw, 25px); line-height: 1.4; color: #4b415f; max-width: 42em; }
  .pills { display: flex; gap: .8vw; margin-top: 2.2vw; flex-wrap: wrap; }
  .pill { font-size: clamp(9px, 1.2vw, 16px); font-weight: 700; padding: .45vw 1vw; border-radius: 999px; border: 1px solid rgba(23, 17, 38, .1); background: rgba(255,255,255,.72); }
  .get { color: #1d4ed8; } .post { color: #047857; } .put { color: #c2410c; } .del { color: #b91c1c; }
</style>
</head>
<body>
  <div class="grid"></div>
  <div class="wrap">
    <img class="mark" src="${logo}" alt="">
    <div class="copy">
      <div class="eyebrow">RouteCraft · OpenAPI</div>
      <h1>Read the docs.<br>Send the request.</h1>
      <p>A clean API explorer with a built-in console. OpenAPI 2.0, 3.0 and 3.1 — with zero-CORS execution.</p>
      <div class="pills">
        <span class="pill get">GET</span>
        <span class="pill post">POST</span>
        <span class="pill put">PUT</span>
        <span class="pill del">DELETE</span>
      </div>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  for (const [width, height, name] of [
    [440, 280, 'promo-tile-440x280.png'],
    [1400, 560, 'promo-marquee-1400x560.png'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: resolve(out, name) });
    await page.close();
    console.log(`Wrote store-assets/${name}`);
  }
} finally {
  await browser.close();
}
