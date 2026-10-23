// End-to-end test: builds, loads the unpacked Chrome build in Chromium, and serves local pages at
// the demo shop's real address (https://cig13zs.github.io/timertruth/...) so the content script
// injects exactly as it does there. Covers the reload test ("Test this timer"), the honest timer
// on the same page, countdowns that restart by design, the popup, the per-site switch, forgetting
// a page, and the userscript build. Writes tests/screenshots/ for a look when something fails.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('../build.mjs'); // always test what src/ says now
const EXT = path.join(root, 'dist', 'chrome');
const SITE = 'https://cig13zs.github.io/timertruth';
const DEMO = `${SITE}/demo/`;
const TRICKY = `${SITE}/test/tricky`;
const HONEST = `${SITE}/demo/honest`;
const SHOTS = path.join(root, 'tests', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const DEMO_HTML = fs.readFileSync(path.join(root, 'docs', 'demo', 'index.html'), 'utf8');
// The same shop with the tricks taken out: the flash sale counts down to a fixed time and the
// counters only drift. "Test this timer" must call this one real.
export const HONEST_HTML = DEMO_HTML
  .replace('var left = Math.max(0, 600 - Math.floor((Date.now() - start) / 1000));',
    'var left = Math.max(0, Math.floor((Math.ceil((start + 60e3) / 14400e3) * 14400e3 - Date.now()) / 1000));')
  .replace('var VIEWERS = [23, 41, 17, 38, 12, 44, 29, 51, 8, 35];', 'var VIEWERS = [118, 121, 119, 124];')
  .replace('var STOCK = [3, 7, 2, 5, 4, 6];', 'var STOCK = [9, 9, 8, 8];')
  .replace(/Nothing here is for sale\. The flash-sale countdown[\s\S]*?does not move\./,
    'Nothing here is for sale. This copy has the tricks taken out: both countdowns run to fixed times and the counters only drift.');
const PAGES = {
  '/timertruth/demo/': DEMO_HTML,
  '/timertruth/demo/honest': HONEST_HTML,
  '/timertruth/test/tricky': fs.readFileSync(path.join(root, 'tests', 'fixtures', 'live-tricky.html'), 'utf8'),
};

const errors = [];
export async function serve(route) {
  const u = new URL(route.request().url());
  const body = PAGES[u.pathname];
  if (body) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
}

export async function launch({ viewport = { width: 1280, height: 800 }, deviceScaleFactor = 1, ext = EXT } = {}) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport,
    deviceScaleFactor,
  });
  context.setDefaultTimeout(10000);
  await context.route(`${SITE}/**`, serve);
  const page = context.pages()[0] || await context.newPage();
  // Content scripts run in an isolated world Playwright does not report; CDP sees them.
  const cdp = await context.newCDPSession(page);
  let extId = null;
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.origin.startsWith('chrome-extension://')) extId = new URL(c.origin).host;
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => errors.push(`exception on ${page.url()}: ${d.exception?.description || d.text}`));
  await cdp.send('Runtime.enable');
  return { context, page, ext: () => extId };
}

const layer = (p) => p.locator('timertruth-layer');
const badgeTexts = (p) => p.evaluate(() => {
  const host = document.querySelector('timertruth-layer');
  if (!host || !host.shadowRoot) return [];
  return [...host.shadowRoot.querySelectorAll('.b')].filter((b) => !b.hidden).map((b) => b.textContent.trim());
});

let passed = 0, failed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`);
  }
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const { context, page, ext } = await launch();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Every request any page or the extension makes, other than the local pages served above.
  const outside = [];
  context.on('request', (r) => { if (!/^(https:\/\/cig13zs\.github\.io\/timertruth\/|chrome-extension:|data:)/.test(r.url())) outside.push(r.url()); });
  let loads = 0;
  page.on('load', () => loads++);

  await step('demo shop, first visit: the flash-sale timer is picked up and marked "watching"', async () => {
    await page.goto(DEMO);
    await layer(page).locator('.watch').first().waitFor();
    const texts = await badgeTexts(page);
    assert.ok(texts.includes('watching · reload to test'), texts.join(' | '));
    assert.ok(ext(), 'content script context not found');
  });

  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push(`popup pageerror: ${e.message}`));
  const POPUP = `chrome-extension://${ext()}/popup.html?url=${encodeURIComponent(DEMO)}`;

  await step('popup lists what it found on the page', async () => {
    await popup.goto(POPUP);
    await popup.locator('#items li', { hasText: 'Countdown' }).first().waitFor();   // the timer's reading lands ~1 s after the counters'
    const rows = await popup.locator('#items li .what').allTextContents();
    assert.ok(rows.some((r) => r.startsWith('Countdown')), rows.join(' | '));
    assert.ok(rows.some((r) => r.startsWith('"People viewing"')), rows.join(' | '));
    assert.ok(rows.some((r) => r.startsWith('"Only N left"')), rows.join(' | '));
    assert.equal(await popup.locator('#on').isChecked(), true);
  });

  await step('Test this timer: three reloads by itself, then "FAKE: reset 3×" over the fake timer', async () => {
    loads = 0;
    await popup.locator('#test').click();
    await page.bringToFront();
    const verdict = layer(page).locator('.hud.v-fake .big');
    await verdict.waitFor({ timeout: 30000 });
    assert.equal(await verdict.textContent(), 'FAKE: reset 3×');
    assert.equal(loads, 3, `expected 3 reloads, saw ${loads}`);
    const stamp = layer(page).locator('.b.fake');
    await stamp.waitFor();
    assert.equal((await stamp.textContent()).trim(), 'FAKEreset 3×');
    const texts = await badgeTexts(page);
    assert.ok(texts.includes('✓ consistent · 4 loads'), `honest voucher timer: ${texts.join(' | ')}`);
    assert.ok(texts.some((t) => t.startsWith('RANDOM: ')), `viewer count: ${texts.join(' | ')}`);
    assert.ok(texts.some((t) => t.startsWith('Stock went up: ')), `stock: ${texts.join(' | ')}`);
    // The stamp sits over the timer it describes.
    const s = await stamp.boundingBox();
    const t = await page.locator('#fake-timer').boundingBox();
    const cx = s.x + s.width / 2, cy = s.y + s.height / 2;
    assert.ok(Math.abs(cx - (t.x + t.width / 2)) < 4 && Math.abs(cy - (t.y + t.height / 2)) < 4, 'stamp is centred on the timer');
    await page.screenshot({ path: path.join(SHOTS, 'demo-verdict.png') });
  });

  await step('popup shows the verdict and the totals', async () => {
    await popup.reload();
    await popup.locator('#status.fake').waitFor();
    assert.equal(await popup.locator('#status b').textContent(), 'FAKE: reset 3×');
    const chips = await popup.locator('#items .chip').allTextContents();
    assert.equal(chips[0], 'FAKE: reset 3×');
    const totals = await popup.locator('#totals').textContent();
    assert.match(totals, /2 countdowns checked · 1 fake · 1 consistent/);
    await popup.screenshot({ path: path.join(SHOTS, 'popup.png') });
  });

  await step('clicking the stamp shows the evidence', async () => {
    await layer(page).locator('.b.fake').click();
    const card = layer(page).locator('.card');
    await card.waitFor();
    const text = await card.textContent();
    assert.match(text, /The deadline moved later 3× before it was reached\./);
    assert.match(text, /It starts at 10:00 on every load\./);
  });

  await step('the same shop with a real deadline: "This timer looks real", no FAKE anywhere', async () => {
    await page.goto(HONEST);
    await page.waitForTimeout(1500);
    loads = 0;
    await popup.goto(`chrome-extension://${ext()}/popup.html?url=${encodeURIComponent(HONEST)}`);
    await popup.locator('#test:not([disabled])').click();
    await page.bringToFront();
    const verdict = layer(page).locator('.hud.v-ok .big');
    await verdict.waitFor({ timeout: 30000 });
    assert.equal(await verdict.textContent(), 'This timer looks real');
    assert.equal(loads, 3);
    const texts = await badgeTexts(page);
    assert.deepEqual(texts.sort(), ['✓ consistent · 4 loads', '✓ consistent · 4 loads'], texts.join(' | '));
  });

  await step('countdowns that restart by design are never stamped (delivery, OTP, video, clock, printed date)', async () => {
    await page.goto(TRICKY);
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(2600);
      await page.reload();
    }
    await page.waitForTimeout(2600);
    const texts = await badgeTexts(page);
    assert.deepEqual(texts, ['✓ consistent · 4 loads'], texts.join(' | '));
    await popup.goto(`chrome-extension://${ext()}/popup.html?url=${encodeURIComponent(TRICKY)}`);
    await popup.locator('#items li').first().waitFor();
    const rows = await popup.locator('#items li').allTextContents();
    assert.equal(rows.length, 3, rows.join(' | '));   // the deal timer, viewers, stock
    assert.ok(!rows.some((r) => /FAKE|RANDOM|went up/.test(r)), rows.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'tricky.png') });
  });

  await step('per-site switch: off removes the marks and stops recording; on brings them back', async () => {
    await popup.locator('#on').uncheck();
    await page.waitForTimeout(300);
    assert.deepEqual(await badgeTexts(page), []);
    const before = await popup.evaluate(() => chrome.storage.local.get(null).then((s) => JSON.stringify(s['p:cig13zs.github.io/timertruth/test/tricky'])));
    await page.reload();
    await page.waitForTimeout(2500);
    assert.deepEqual(await badgeTexts(page), []);
    const after = await popup.evaluate(() => chrome.storage.local.get(null).then((s) => JSON.stringify(s['p:cig13zs.github.io/timertruth/test/tricky'])));
    assert.equal(after, before, 'nothing recorded while off');
    await popup.locator('#on').check();
    await layer(page).locator('.ok').waitFor();
  });

  await step('forget this page wipes its record', async () => {
    await popup.locator('#forget').click();
    await popup.locator('#msg', { hasText: 'Forgot everything' }).waitFor();
    const left = await popup.evaluate(() => chrome.storage.local.get(null).then((s) => Object.keys(s).filter((k) => k.includes('/test/tricky'))));
    assert.deepEqual(left, []);
  });

  await step('nothing in storage but readings, settings and the test state; no network requests from the extension', async () => {
    const keys = await popup.evaluate(() => chrome.storage.local.get(null).then((s) => Object.keys(s)));
    for (const k of keys) assert.match(k, /^(p:|h:|off:|demo$|sites$)/, k);
    assert.deepEqual(outside, [], 'requests outside the local test pages');
  });

  await context.close();

  // ---- userscript build, in a plain browser with a small GM_* stand-in ----
  await step('userscript: same detection, menu command runs the 3-reload test', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(`${SITE}/**`, serve);
    const us = fs.readFileSync(path.join(root, 'dist', 'timertruth.user.js'), 'utf8');
    await ctx.addInitScript(`(() => {
      const K = '__gm:';
      window.GM_getValue = (k, d) => { const v = localStorage.getItem(K + k); return v == null ? d : JSON.parse(v); };
      window.GM_setValue = (k, v) => localStorage.setItem(K + k, JSON.stringify(v));
      window.GM_deleteValue = (k) => localStorage.removeItem(K + k);
      window.GM_listValues = () => Object.keys(localStorage).filter((k) => k.startsWith(K)).map((k) => k.slice(K.length));
      window.__menu = {};
      window.GM_registerMenuCommand = (name, fn) => { window.__menu[name] = fn; };
      addEventListener('load', () => setTimeout(() => { (0, eval)(${JSON.stringify(us)}); }, 50));
    })();`);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`userscript pageerror: ${e.message}`));
    await p.goto(DEMO);
    await p.locator('timertruth-layer').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.__menu && window.__menu['Test this timer (reloads 3 times)']);
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__menu['Test this timer (reloads 3 times)']());
    const verdict = p.locator('timertruth-layer .hud.v-fake .big');
    await verdict.waitFor({ timeout: 30000 });
    assert.equal(await verdict.textContent(), 'FAKE: reset 3×');
    await browser.close();
  });

  if (errors.length) {
    failed++;
    console.log(`FAIL errors from the page or the extension:\n     ${errors.join('\n     ')}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
