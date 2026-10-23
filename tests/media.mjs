// Records the media for the README, the stores and the Tool Drawer Short, from the real extension
// running on the demo shop (served locally at its GitHub Pages address, as in e2e.mjs).
//   docs/media/timertruth-short-1080x1920.mp4   vertical money shot: timer, 3 reloads, FAKE stamp
//   docs/media/hero.gif                         the same moment for the README
//   docs/media/store-1..4-1280x800.png          store screenshots with a caption band
// Frames come from Chrome's screencast (one per repaint, with timestamps), so the reloads and the
// stamp animation play back at real speed. Needs ffmpeg on PATH; without it the raw frames are
// left in tests/.frames/ and the script says so.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launch } from './e2e.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'docs', 'media');
const FRAMES = path.join(root, 'tests', '.frames');
const SITE = 'https://cig13zs.github.io/timertruth';
const DEMO = `${SITE}/demo/`;
const HONEST = `${SITE}/demo/honest`;
fs.mkdirSync(OUT, { recursive: true });

let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }

// Opens a fresh profile, loads the page, and returns a way to run code in the content script's
// own world (where the popup's "Test this timer" button runs it).
async function open(url, opts) {
  const s = await launch(opts);
  const cdp = await s.context.newCDPSession(s.page);
  let world = null;
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.origin.startsWith('chrome-extension://')) world = c.id;
  });
  await cdp.send('Runtime.enable');
  await s.page.goto(url);
  await s.page.locator('timertruth-layer .b').first().waitFor();
  const inWorld = (expression) => cdp.send('Runtime.evaluate', { expression, contextId: world, awaitPromise: true });
  return { ...s, cdp, inWorld };
}

async function runTest(s, verdictClass) {
  await s.inWorld('globalThis.__ttLive.startDemo()');
  await s.page.locator(`timertruth-layer .hud.${verdictClass}`).waitFor({ timeout: 40000 });
}

// Screencast the page while fn runs. Returns [{ file, dur }] with real frame timings.
async function record(s, name, size, fn) {
  const dir = path.join(FRAMES, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = async ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    s.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  };
  s.cdp.on('Page.screencastFrame', onFrame);
  const start = () => s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 });
  await start();
  // A reload can end the screencast; start it again on every load to be safe.
  const again = () => start().catch(() => {});
  s.page.on('load', again);
  await fn();
  await s.cdp.send('Page.stopScreencast').catch(() => {});
  s.page.off('load', again);
  s.cdp.off('Page.screencastFrame', onFrame);
  frames.sort((a, b) => a.t - b.t);
  return frames.map((f, i) => ({ file: f.file, dur: i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - f.t) : 0.5 }));
}

function concatList(name, frames, holdLast) {
  const list = path.join(FRAMES, `${name}.txt`);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    lines.push(`file '${f.file}'`, `duration ${(i === frames.length - 1 ? holdLast : f.dur).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return list;
}

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

// ---- 1. The Short: 1080x1920, phone-width layout at 2x ----------------------------------------
{
  const s = await open(DEMO, { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  const frames = await record(s, 'short', { w: 1080, h: 1920 }, async () => {
    await s.page.waitForTimeout(2600);          // the timer ticking, before anything happens
    await runTest(s, 'v-fake');
    await s.page.waitForTimeout(3800);          // hold on the stamp
  });
  await s.context.close();
  if (ffmpeg) {
    const list = concatList('short', frames, 0.6);
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=1080:1920:flags=lanczos,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', path.join(OUT, 'timertruth-short-1080x1920.mp4')]);
    console.log(`docs/media/timertruth-short-1080x1920.mp4 (${frames.length} frames)`);
  } else {
    console.log(`ffmpeg not found: ${frames.length} PNG/JPEG frames left in tests/.frames/short/`);
  }
}

// ---- 2. README hero GIF: desktop layout --------------------------------------------------------
{
  const s = await open(DEMO, { viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  const frames = await record(s, 'hero', { w: 1000, h: 640 }, async () => {
    await s.page.waitForTimeout(1800);
    await runTest(s, 'v-fake');
    await s.page.waitForTimeout(3200);
  });
  await s.context.close();
  if (ffmpeg) {
    const list = concatList('hero', frames, 1.5);
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf',
      'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      '-loop', '0', path.join(OUT, 'hero.gif')]);
    console.log(`docs/media/hero.gif (${(fs.statSync(path.join(OUT, 'hero.gif')).size / 1e6).toFixed(1)} MB)`);
  }
}

// ---- 3. Store screenshots: 1280x800 = a 96 px caption band over a 1280x704 page ------------------
const shots = {};
{
  const s = await open(DEMO, { viewport: { width: 1280, height: 704 } });
  await s.page.waitForTimeout(1200);
  await runTest(s, 'v-fake');
  await s.page.waitForTimeout(900);
  shots.fake = await s.page.screenshot();
  await s.page.locator('timertruth-layer .hud .x').click();
  await s.page.locator('timertruth-layer .b.fake').click();
  await s.page.locator('timertruth-layer .card').waitFor();
  await s.page.waitForTimeout(300);
  shots.evidence = await s.page.screenshot();
  await s.page.locator('body').click({ position: { x: 5, y: 700 } });
  await s.page.waitForTimeout(200);
  shots.page = await s.page.screenshot();
  const popup = await s.context.newPage();
  await popup.setViewportSize({ width: 360, height: 704 });
  await popup.goto(`chrome-extension://${(await s.ext())}/popup.html?url=${encodeURIComponent(DEMO)}`);
  await popup.locator('#status.fake').waitFor();
  await popup.waitForTimeout(300);
  const box = await popup.locator('body').boundingBox();
  shots.popup = await popup.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) } });
  await s.context.close();
}
{
  const s = await open(HONEST, { viewport: { width: 1280, height: 704 } });
  await s.page.waitForTimeout(1200);
  await runTest(s, 'v-ok');
  await s.page.waitForTimeout(900);
  shots.honest = await s.page.screenshot();
  await s.context.close();
}

const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const band = (title, sub) => `<div class="band"><div class="t">${title}</div><div class="s">${sub}</div></div>`;
const STYLE = `<style>
  body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#121821}
  .band{height:96px;box-sizing:border-box;padding:18px 32px 0;color:#fff}
  .t{font-size:30px;font-weight:850;letter-spacing:-.02em} .s{margin-top:4px;font-size:16px;color:#c4ced8}
  .page{position:relative;width:1280px;height:704px;overflow:hidden}
  .page img.bg{display:block;width:1280px;height:704px}
  .dim{position:absolute;inset:0;background:rgba(10,14,20,.35)}
  .pop{position:absolute;right:24px;top:10px;border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden;background:#fff}
  .pop img{display:block}
</style>`;
const scenes = [
  ['store-1-fake-timer', band('This sale timer is fake. Watch it reset.', 'Test this timer reloads the page 3 times. The countdown started over from 10:00 every time.'), `<div class="page"><img class="bg" src="${b64(shots.fake)}"></div>`],
  ['store-2-honest-timer', band('Real deadlines get a quiet check mark', 'The same shop with an honest countdown: the deadline held across every reload, so no stamp.'), `<div class="page"><img class="bg" src="${b64(shots.honest)}"></div>`],
  ['store-3-popup', band('Everything it saw, on this page and in total', 'Kept on your device only. No account, no server, no analytics.'), `<div class="page"><img class="bg" src="${b64(shots.page)}"><div class="dim"></div><div class="pop"><img src="${b64(shots.popup)}"></div></div>`],
  ['store-4-evidence', band('Click the stamp for the evidence', 'Each load: the time it showed, the deadline that implies, and what moved.'), `<div class="page"><img class="bg" src="${b64(shots.evidence)}"></div>`],
];
const browser = await chromium.launch();
const comp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const [name, top, body] of scenes) {
  await comp.setContent(`<!doctype html>${STYLE}${top}${body}`);
  await comp.waitForTimeout(100);
  await comp.screenshot({ path: path.join(OUT, `${name}-1280x800.png`) });
  console.log(`docs/media/${name}-1280x800.png`);
}
await browser.close();
if (ffmpeg) fs.rmSync(FRAMES, { recursive: true, force: true });
