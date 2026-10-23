/* TimerTruth popup. Reads what the content script recorded for the current
 * page straight from storage, and drives the page through chrome.scripting.
 */
const { judge: J, history: H } = globalThis.TT;
const $ = (id) => document.getElementById(id);
const CONTENT = ['lib/parse.js', 'lib/scan.js', 'lib/judge.js', 'lib/history.js', 'platform.js', 'ui.js', 'content.js'];
const store = chrome.storage.local;

// ?url=<page> targets the tab showing that page instead of the active tab.
// Used by the end-to-end test and the screenshot script, which open this
// popup as an ordinary tab.
const override = new URLSearchParams(location.search).get('url');

let tab = null, url = null, host = '', path = '', pageKey = '';

async function findTab() {
  if (override) {
    // Without the "tabs" permission a tab's URL is only visible on sites the
    // extension may read, so fall back to the most recently used other tab.
    const self = await chrome.tabs.getCurrent();
    const tabs = (await chrome.tabs.query({})).filter((t) => !self || t.id !== self.id);
    return tabs.find((t) => t.url === override)
      || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
  }
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

// Is this page one of the shops the manifest lists? Match patterns to regexes.
function listed(u) {
  const pats = chrome.runtime.getManifest().content_scripts.flatMap((c) => c.matches);
  return pats.some((p) => {
    const m = /^(\*|https?):\/\/(\*\.)?([^/]*)(\/.*)$/.exec(p);
    if (!m) return false;
    const re = new RegExp(`^${m[1] === '*' ? 'https?' : m[1]}://${m[2] ? '([^/]*\\.)?' : ''}${m[3].replace(/\./g, '\\.')}${m[4].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return re.test(u);
  });
}

async function run(func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return r ? r.result : undefined;
}

const liveStatus = () => run(() => (globalThis.__ttLive ? globalThis.__ttLive.status() : null));

// ---- page list and totals --------------------------------------------------------

const NAME = { timer: 'Countdown', viewers: '"People viewing"', carts: '"In carts"', bought: '"Bought recently"', stock: '"Only N left"', today: '"Ends today"' };

function describe(item) {
  const last = item.obs[item.obs.length - 1];
  if (item.kind === 'timer') return item.label && item.label !== 'timer' ? `"${item.label}"` : 'countdown';
  if (item.kind === 'today') return item.text || '';
  const vals = item.obs.slice(-5).map((o) => o.v);
  return last ? `seen: ${vals.join(' → ')}` : '';
}

const short = (v) => {
  if (v.level === 'fake') return v.title;
  if (v.level === 'none') return v.state === 'steady' ? 'steady' : 'watching';
  return v.badge;
};

async function renderPage() {
  const got = await store.get([pageKey, H.indexKey(host)]);
  const rec = got[pageKey];
  const entries = (got[H.indexKey(host)] || {}).entries || [];
  const list = $('items');
  list.textContent = '';
  const items = rec ? Object.values(rec.items).filter((i) => i.obs.length) : [];
  const order = { fake: 0, warn: 1, ok: 2, watch: 3, none: 4 };
  const rows = items.map((item) => ({ item, v: J.verdict(item, entries, path) }))
    .sort((a, b) => order[a.v.level] - order[b.v.level]);
  for (const { item, v } of rows) {
    const li = document.createElement('li');
    const what = document.createElement('div');
    what.className = 'what';
    what.textContent = NAME[item.kind] || item.kind;
    const sub = document.createElement('span');
    sub.textContent = describe(item);
    what.append(sub);
    const chip = document.createElement('span');
    chip.className = `chip c-${v.level}`;
    chip.textContent = short(v);
    chip.title = [v.title, ...v.lines].join('\n');
    li.append(what, chip);
    list.append(li);
  }
  $('empty').hidden = rows.length > 0;
  $('copy').disabled = $('forget').disabled = rows.length === 0;
  return { rec, rows };
}

async function renderTotals() {
  const all = await store.get(null);
  const t = { timers: 0, fake: 0, consistent: 0, random: 0, stock: 0, pages: 0, shops: new Set() };
  for (const [k, rec] of Object.entries(all)) {
    if (!k.startsWith('p:') || !rec.items) continue;
    const entries = (all[H.indexKey(rec.host)] || {}).entries || [];
    let any = false;
    for (const item of Object.values(rec.items)) {
      if (!item.obs.length) continue;
      any = true;
      const v = J.verdict(item, entries, rec.path);
      if (item.kind === 'timer') {
        t.timers++;
        if (v.level === 'fake') t.fake++;
        if (v.state === 'consistent') t.consistent++;
      } else if (item.kind === 'stock') {
        if (v.level === 'warn') t.stock++;
      } else if (item.kind !== 'today' && v.level === 'warn') {
        t.random++;
      }
    }
    if (any) { t.pages++; t.shops.add(rec.host); }
  }
  const el = $('totals');
  if (!t.pages) { el.textContent = 'Nothing recorded yet.'; return; }
  el.innerHTML = '';
  const line = (parts) => {
    const d = document.createElement('div');
    parts.forEach(([n, label], i) => {
      if (i) d.append(' · ');
      const b = document.createElement('b');
      b.textContent = n;
      d.append(b, ` ${label}`);
    });
    el.append(d);
  };
  line([[t.timers, t.timers === 1 ? 'countdown checked' : 'countdowns checked'], [t.fake, 'fake'], [t.consistent, 'consistent']]);
  line([[t.random, t.random === 1 ? 'made-up counter' : 'made-up counters'], [t.stock, t.stock === 1 ? 'stock reset' : 'stock resets'], [t.shops.size, t.shops.size === 1 ? 'shop' : 'shops']]);
}

// ---- Test this timer ----------------------------------------------------------------

function showDemo(d) {
  const s = $('status');
  s.className = '';
  s.textContent = '';
  if (!d || d.page !== pageKey) return;
  if (d.done) {
    s.className = d.done.level;
    const b = document.createElement('b');
    b.textContent = d.done.headline;
    s.append(b);
    if (d.done.lines.length) {
      const ul = document.createElement('ul');
      for (const l of d.done.lines.slice(0, 4)) {
        const li = document.createElement('li');
        li.textContent = l;
        ul.append(li);
      }
      s.append(ul);
    }
    $('test').disabled = false;
    $('test').textContent = 'Test again';
    return;
  }
  if (Date.now() - d.updated > 25e3) return;
  s.textContent = d.step ? `Reload ${d.step} of ${d.total}…${d.resets ? ` Resets so far: ${d.resets}.` : ''}` : 'Reading the timer…';
  $('test').disabled = true;
}

$('test').addEventListener('click', async () => {
  $('test').disabled = true;
  try {
    const ok = await run(() => (globalThis.__ttLive ? globalThis.__ttLive.startDemo() : false));
    if (!ok) throw new Error('not running');
  } catch {
    $('msg').textContent = 'Could not start: reload the page and try again.';
    $('test').disabled = false;
  }
});

// ---- other buttons ------------------------------------------------------------------

$('on').addEventListener('change', async () => {
  await store.set({ [H.offKey(host)]: !$('on').checked });
  $('main').classList.toggle('off', !$('on').checked);
  $('test').disabled = !$('on').checked;
});

$('forget').addEventListener('click', async () => {
  try { await run(() => globalThis.__ttLive && globalThis.__ttLive.forget()); } catch { /* page gone */ }
  await store.remove(pageKey);
  const got = await store.get(H.indexKey(host));
  const idx = got[H.indexKey(host)];
  if (idx) {
    idx.entries = idx.entries.filter((e) => e.p !== path);
    await store.set({ [H.indexKey(host)]: idx });
  }
  $('msg').textContent = 'Forgot everything recorded on this page.';
  $('status').textContent = '';
  renderPage();
  renderTotals();
});

$('copy').addEventListener('click', async () => {
  const { rows } = await renderPage();
  const out = [`TimerTruth readings for ${host}${path}`, 'Recorded in my browser by the TimerTruth extension. Times are my local time.', ''];
  for (const { item, v } of rows) {
    out.push(`${NAME[item.kind] || item.kind}${item.kind === 'timer' ? ` ${describe(item)}` : ''}: ${v.title}`);
    for (const l of v.lines) out.push(`  ${l}`);
    if (item.kind !== 'timer' && item.kind !== 'today') out.push(`  Values: ${item.obs.map((o) => `${o.v} at ${J.clock(o.t)}`).join(', ')}`);
    out.push('');
  }
  try {
    await navigator.clipboard.writeText(out.join('\n'));
    $('msg').textContent = 'Copied. Paste it wherever you want to share it.';
  } catch {
    $('msg').textContent = 'Could not reach the clipboard.';
  }
});

// Sites outside the list: a one-off check needs nothing beyond activeTab. The
// test reloads the page, which ends activeTab's access, so it asks for this
// one site and registers the same content script for it.
$('check').addEventListener('click', async () => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT });
    $('umsg').textContent = 'Checked. Anything found is marked on the page. Reloading needs "Watch this site".';
  } catch {
    $('umsg').textContent = 'This page cannot be read by extensions.';
  }
});

$('allow').addEventListener('click', () => {
  const origin = new URL(url).origin;
  // Firefox only honours a permission request made straight from the click,
  // so this must be the first thing the handler does.
  chrome.permissions.request({ origins: [`${origin}/*`] }).then(async (ok) => {
    if (!ok) { $('umsg').textContent = 'Not allowed. Nothing changed.'; return; }
    await watchSite(origin);
    const live = await liveStatus().catch(() => null);
    if (!live) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT });
    await new Promise((r) => setTimeout(r, 400));
    await run(() => globalThis.__ttLive && globalThis.__ttLive.startDemo());
    init();
  });
});

async function watchSite(origin) {
  const id = `site-${new URL(origin).host}`;
  const have = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (!have.length) {
    await chrome.scripting.registerContentScripts([{ id, matches: [`${origin}/*`], js: CONTENT, runAt: 'document_idle', persistAcrossSessions: true }]);
  }
  const { sites = [] } = await store.get('sites');
  if (!sites.includes(origin)) await store.set({ sites: [...sites, origin] });
}

// Firefox may drop dynamically registered scripts on restart; put back any
// whose site permission is still granted.
async function restoreSites() {
  const { sites = [] } = await store.get('sites');
  for (const origin of sites) {
    if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) await watchSite(origin).catch(() => {});
  }
}

// ---- start ---------------------------------------------------------------------------

async function init() {
  restoreSites().catch(() => {});
  tab = await findTab();
  url = (tab && tab.url) || override;
  if (!url || !/^https?:/.test(url)) { $('blocked').hidden = false; return; }
  const u = new URL(url);
  host = H.hostOf(u.hostname);
  path = H.pagePath(u.pathname, host);
  pageKey = H.pageKey(host, path);
  $('host').textContent = host;
  $('uhost').textContent = host;

  let live = null;
  try { live = tab ? await liveStatus() : null; } catch { $('blocked').hidden = false; return; }
  if (!live && !listed(url)) {
    const { sites = [] } = await store.get('sites');
    if (!sites.includes(u.origin)) { $('unlisted').hidden = false; $('main').hidden = true; return; }
  }
  $('unlisted').hidden = true;
  $('main').hidden = false;
  $('swWrap').hidden = false;
  const off = (await store.get(H.offKey(host)))[H.offKey(host)];
  $('on').checked = !off;
  $('test').disabled = !!off || !live;
  if (!live && !off) $('msg').textContent = 'Reload the page to start watching it.';
  showDemo((await store.get('demo')).demo);
  await renderPage();
  await renderTotals();
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.demo) showDemo(ch.demo.newValue);
  if (ch[pageKey]) { renderPage(); renderTotals(); }
});

init();
