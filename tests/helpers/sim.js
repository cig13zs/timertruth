// Replays page loads in Node. A "page" is a function (t) => HTML: what the page shows at time t
// during one load. runLoad scans it the way content.js does, watches each timer for ~1.3 s by
// re-rendering it every 100 ms, and files the readings into a history record.
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./minidom.js');
const { scan, readText } = require('../../src/lib/scan.js');
const J = require('../../src/lib/judge.js');
const H = require('../../src/lib/history.js');

const FIX = path.join(__dirname, '..', 'fixtures');
const cache = new Map();
function fixture(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(FIX, name), 'utf8'));
  return cache.get(name);
}
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
const p2 = (n) => String(n).padStart(2, '0');
const hms = (sec) => `${p2(Math.floor(sec / 3600))}:${p2(Math.floor((sec % 3600) / 60))}:${p2(sec % 60)}`;
const mmss = (sec) => `${p2(Math.floor(sec / 60))}:${p2(sec % 60)}`;

// Small seeded RNG so "random" scenarios are repeatable.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// What a page's own ticking code shows: it redraws every second at some phase after load and
// rounds the time left up (most timer libraries) or down.
function shownLeft(deadline, t, loadStart, phase, round = 'ceil') {
  const since = t - loadStart - phase;
  const u = since < 0 ? loadStart : loadStart + phase + Math.floor(since / 1000) * 1000;
  const left = (deadline - u) / 1000;
  return Math.max(0, round === 'ceil' ? Math.ceil(left) : Math.floor(left));
}

function newState(host = 'shop.test', pagePath = '/item-1') {
  return { host, path: pagePath, rec: H.newRecord(host, pagePath, 0), index: { entries: [] } };
}

let loadSeq = 0;
function runLoad(state, page, loadStart, { scanDelay = 300, path: pagePath } = {}) {
  if (pagePath && pagePath !== state.path) {
    state.path = pagePath;
    state.rec = state.records?.[pagePath] || H.newRecord(state.host, pagePath, loadStart);
  }
  const loadId = `L${++loadSeq}`;
  const t0 = loadStart + scanDelay;
  const cands = scan(parse(page(t0)).body);
  for (const c of cands) {
    let obs = null;
    if (c.kind === 'timer') {
      const samples = [];
      for (let k = 0; k <= 13; k++) {
        const tk = t0 + k * 100;
        const again = scan(parse(page(tk)).body).find((x) => x.key === c.key);
        if (!again) continue;
        const rt = readText(again.el);
        samples.push({ t: tk, text: rt.compact, spaced: rt.spaced });
      }
      obs = J.observeTimer(c, samples, loadStart);
    } else if (c.kind === 'today') {
      obs = { t: t0 };
    } else {
      obs = J.observeValue(t0, c.parsed.value);
    }
    if (!obs) continue;
    if (H.addObservation(state.rec, c, obs, loadId, t0)) H.updateIndex(state.index, state.path, c.key, state.rec.items[c.key]);
  }
  state.records = { ...(state.records || {}), [state.path]: state.rec };
  return cands;
}

function verdicts(state) {
  const out = {};
  for (const [key, item] of Object.entries(state.rec.items)) out[key] = J.verdict(item, state.index.entries, state.path);
  return out;
}

const byKind = (state, kind) => Object.entries(state.rec.items).filter(([, it]) => it.kind === kind).map(([k]) => k);

module.exports = { fixture, fill, hms, mmss, p2, rng, shownLeft, newState, runLoad, verdicts, byKind, parse, scan };
