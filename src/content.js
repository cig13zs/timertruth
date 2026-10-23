/* TimerTruth - the content script. Finds countdowns and urgency counters on
 * the page, takes one reading of each per page load, files it locally, and
 * stamps the verdict over the element.
 *
 * Also runs "Test this timer": reload the tab three times by itself and
 * report whether the countdown restarted. The test's progress lives in
 * storage, because every reload starts this script from scratch.
 */
(() => {
  'use strict';
  // The popup can inject this file into a tab that already runs it (activeTab
  // on a shop we do not list). Then just rescan instead of starting twice.
  if (globalThis.__ttLive) { globalThis.__ttLive.rescan(); return; }

  const TT = globalThis.TT;
  const S = TT.scan, J = TT.judge, H = TT.history, X = TT.platform;
  const HOST = H.hostOf(location.hostname);
  const OFF = H.offKey(HOST);
  const IDX = H.indexKey(HOST);

  const SAMPLE_EVERY = 100;   // ms between readings while waiting for a timer to tick
  const SAMPLE_FOR = 1300;    // long enough to see one tick of a seconds timer
  const RELOADS = 3;          // "Test this timer"
  const DEMO_STALE = 25e3;    // a test that has not moved for this long was abandoned
  const MAX_WATCH_CHIPS = 3;  // more first-sighting chips than this is clutter on a grid

  let enabled = false;
  let view = null;
  let index = { entries: [] };
  let demo = null;
  let ui = null;
  let scanTimer = 0, lastScan = 0, scanCost = 0, saveTimer = 0, saves = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = () => Math.random().toString(36).slice(2, 10);

  // One page view: a full load, or an in-app navigation on a single-page shop.
  function newView(spa) {
    const path = H.pagePath(location.pathname, HOST);
    return {
      path,
      key: H.pageKey(HOST, path),
      navTime: spa ? Date.now() : Math.round(performance.timeOrigin || Date.now()),
      started: Date.now(),
      loadId: rand(),
      items: new Map(),     // key -> { key, cand, el, state, tries }
      rec: null,
      pending: 0,
      scans: 0,
    };
  }

  const visible = (el) => el.isConnected && el.getClientRects().length > 0;

  function whenVisible() {
    if (!document.hidden) return Promise.resolve();
    return new Promise((r) => {
      const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); r(); } };
      document.addEventListener('visibilitychange', on);
    });
  }

  // ---- scanning ------------------------------------------------------------------

  function scheduleScan(delay) {
    if (!enabled || !view) return;
    clearTimeout(scanTimer);
    // Busy pages mutate constantly. Early on, keep up; later, slow down; and
    // never spend more than about 5% of the time scanning a huge page.
    const gap = Math.max(Date.now() - view.started < 15e3 ? 700 : 3000, scanCost * 20);
    const wait = delay ?? Math.max(250, gap - (Date.now() - lastScan));
    scanTimer = setTimeout(scanNow, wait);
  }

  function scanNow() {
    if (!enabled || !view || !document.body) return;
    lastScan = Date.now();
    view.scans++;
    let cands;
    try { cands = S.scan(document.body); } catch { return; }
    scanCost = Date.now() - lastScan;
    for (const c of cands) {
      if (!visible(c.el)) continue;
      const it = view.items.get(c.key);
      if (!it) {
        const fresh = { key: c.key, cand: c, el: c.el, state: 'new', tries: 0 };
        view.items.set(c.key, fresh);
        observe(fresh);
      } else {
        it.el = c.el;
        if (it.state === 'retry') { it.cand = c; observe(it); }
      }
    }
    render();
  }

  // One reading for this page view. Timers are watched until they tick so the
  // deadline can be pinned to the moment the digits change (see judge.js).
  async function observe(it) {
    const v = view;
    it.state = 'sampling';
    v.pending++;
    try {
      const c = it.cand;
      let obs = null;
      if (c.kind === 'timer') {
        await whenVisible();
        const samples = [];
        const t0 = Date.now();
        while (Date.now() - t0 <= SAMPLE_FOR && v === view) {
          if (!it.el.isConnected) {
            // Re-rendered under us; find the same timer again by its key.
            const again = S.scan(document.body).find((x) => x.key === it.key);
            if (!again) break;
            it.el = again.el;
          }
          const rt = S.readText(it.el);
          if (rt) samples.push({ t: Date.now(), text: rt.compact, spaced: rt.spaced });
          if (samples.length > 1 && samples[samples.length - 1].text !== samples[0].text) break;
          await sleep(SAMPLE_EVERY);
        }
        obs = J.observeTimer(c, samples, v.navTime);
      } else if (c.kind === 'today') {
        obs = { t: Date.now() };
      } else {
        obs = J.observeValue(Date.now(), c.parsed.value);
      }
      if (v !== view) return;
      if (!obs) {
        it.state = ++it.tries < 3 ? 'retry' : 'rejected';
        return;
      }
      it.state = 'done';
      if (H.addObservation(v.rec, c, obs, v.loadId, Date.now())) {
        H.updateIndex(index, v.path, c.key, v.rec.items[c.key]);
        save();
      }
      render();
    } finally {
      v.pending--;
    }
  }

  function render() {
    if (!view || !ui) return;
    const list = [];
    let watch = 0;
    for (const it of view.items.values()) {
      const item = view.rec.items[it.key];
      if (!item || it.state === 'rejected') continue;
      const v = J.verdict(item, index.entries, view.path);
      if (v.level === 'none') continue;
      if (v.level === 'watch' && ++watch > MAX_WATCH_CHIPS) continue;
      list.push({ key: it.key, el: it.el, v });
    }
    ui.render(list);
  }

  // ---- storage ---------------------------------------------------------------------

  function save() {
    clearTimeout(saveTimer);
    const v = view;
    saveTimer = setTimeout(async () => {
      try {
        await X.set({ [v.key]: v.rec, [IDX]: index });
        if (++saves % 25 === 1) {
          const drop = H.prunePlan(await X.all());
          if (drop.length) await X.remove(drop);
        }
      } catch { /* storage full or context gone: readings for this load are lost, nothing else */ }
    }, 300);
  }

  async function openView(spa) {
    view = newView(spa);
    const v = view;
    if (ui) ui.clear();
    const got = await X.get([v.key, IDX, 'demo']);
    if (v !== view) return;
    v.rec = got[v.key] || H.newRecord(HOST, v.path, Date.now());
    index = got[IDX] || { entries: [] };
    const d = got.demo;
    demo = d && !d.done && d.page === v.key && Date.now() - d.updated < DEMO_STALE ? d : null;
    ui.setQuiet(!!demo);
    if (demo) {
      ui.hud({ mode: 'progress', step: demo.step, total: demo.total, resets: demo.resets || 0, checking: true });
      demoStep(demo);
    }
    scheduleScan(0);
  }

  // ---- Test this timer -------------------------------------------------------------

  async function settled(v) {
    const until = Date.now() + 6000;
    while (Date.now() < until && v === view) {
      if (v.scans > 0 && v.pending === 0 && Date.now() - v.started > 1200) return true;
      await sleep(100);
    }
    return v === view;
  }

  async function startDemo() {
    if (!enabled || !view) return false;
    demo = { page: view.key, step: 0, total: RELOADS, since: view.started, started: Date.now(), updated: Date.now(), resets: 0 };
    await X.set({ demo });
    ui.setQuiet(true);
    ui.hud({ mode: 'progress', step: 0, total: RELOADS, resets: 0, checking: true });
    demoStep(demo);
    return true;
  }

  async function demoStep(d) {
    const v = view;
    if (!(await settled(v)) || demo !== d) return;
    const now = J.demoVerdict(Object.values(v.rec.items), d.since);
    d.resets = now.moves || 0;
    d.timers = now.timers;
    if (d.step < d.total) {
      ui.hud({ mode: 'progress', step: d.step, total: d.total, resets: d.resets, timers: d.timers });
      // Long enough to see the timer tick on camera, and for each restart to
      // move the deadline well past the measuring error.
      await sleep(d.step === 0 ? 1100 : 1500);
      if (demo !== d) return;
      d.step++;
      d.updated = Date.now();
      await X.set({ demo: d });
      location.reload();
      return;
    }
    d.done = { level: now.level, headline: now.headline, lines: now.lines, at: Date.now() };
    d.updated = Date.now();
    demo = null;
    await X.set({ demo: d });
    ui.setQuiet(false);
    render();
    ui.hud({ mode: 'verdict', level: now.level, headline: now.headline, lines: now.lines });
  }

  async function cancelDemo() {
    demo = null;
    if (ui) { ui.setQuiet(false); ui.hud(null); }
    await X.remove('demo');
  }

  async function forget() {
    if (!view) return;
    await X.remove(view.key);
    index.entries = index.entries.filter((e) => e.p !== view.path);
    await X.set({ [IDX]: index });
    view.rec = H.newRecord(HOST, view.path, Date.now());
    view.items.clear();
    view.loadId = rand();
    if (ui) ui.clear();
    scheduleScan(0);
  }

  // ---- switching on and off, navigation -----------------------------------------------

  async function setEnabled(on) {
    if (on === enabled) return;
    enabled = on;
    if (on) await openView(false);
    else { view = null; if (ui) ui.clear(); }
  }

  function checkUrl() {
    if (!enabled || !view) return;
    if (H.pagePath(location.pathname, HOST) !== view.path) openView(true);
  }

  async function start() {
    ui = TT.makeUI();
    const got = await X.get([OFF]);
    X.onChange((ch) => {
      if (OFF in ch) setEnabled(!ch[OFF].newValue);
    });
    if (X.kind === 'userscript') {
      X.menu('Test this timer (reloads 3 times)', () => startDemo());
      X.menu(`Switch TimerTruth on/off for ${HOST}`, () => X.set({ [OFF]: enabled }));
      X.menu('Forget this page', () => forget());
    }
    new MutationObserver((muts) => {
      if (!enabled || !view) return;
      for (const m of muts) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!t) continue;
        let inside = false;
        for (const it of view.items.values()) if (it.el.contains(t)) { inside = true; break; }
        if (!inside) { scheduleScan(); return; }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(checkUrl, 700);
    addEventListener('popstate', checkUrl);
    await setEnabled(!got[OFF]);
  }

  globalThis.__ttLive = {
    rescan: () => scheduleScan(0),
    startDemo,
    cancelDemo,
    forget,
    status: () => ({ host: HOST, enabled, path: view && view.path, items: view ? view.items.size : 0 }),
  };

  start();
})();
