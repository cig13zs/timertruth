// Renders the extension icons and the 440x280 store promo tile from inline SVG/HTML.
// node store/make-art.mjs   (needs the playwright devDependency; uses its Chromium)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A stopwatch on red: the shop's countdown, under suspicion.
export const ICON_SVG = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#d3221a"/>
  <rect x="54" y="13" width="20" height="13" rx="4" fill="#fff"/>
  <path d="M95 30 l9 -9" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
  <circle cx="64" cy="72" r="37" fill="none" stroke="#fff" stroke-width="11"/>
  <path d="M64 72 L81 52" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
  <circle cx="64" cy="72" r="8" fill="#fff"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${ICON_SVG(size)}`);
  await page.screenshot({ path: path.join(root, 'src', 'icons', `icon${size}.png`), omitBackground: true });
}
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<!doctype html><style>
  body{margin:0;width:440px;height:280px;background:#121821;color:#fff;font-family:system-ui,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;overflow:hidden}
  .t{font-size:30px;font-weight:850;letter-spacing:-.02em;line-height:1.1}
  .s{margin-top:10px;font-size:15px;color:#c4ced8;line-height:1.35}
  .stamp{display:inline-block;margin-top:14px;color:#ff4d42;border:3px solid currentColor;border-radius:7px;padding:2px 10px;font-weight:900;font-size:18px;letter-spacing:.06em;transform:rotate(-6deg)}
</style>${ICON_SVG(112)}<div><div class="t">This sale timer<br>is fake.</div><div class="s">Watch it reset. TimerTruth reloads the page and catches it.</div><div class="stamp">FAKE: RESET 3×</div></div>`);
await page.screenshot({ path: path.join(root, 'store', 'promo-440x280.png') });
await browser.close();
console.log('icons and promo tile written');
