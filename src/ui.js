/* TimerTruth - everything drawn on the shop's page.
 *
 * One fixed layer in a shadow root, outside the shop's DOM tree and outside
 * its CSS. Badges are positioned over the elements they describe, so the
 * page's own markup is never touched: a timer that rewrites its innerHTML
 * every second cannot wipe the stamp off, and the shop's layout never shifts.
 */
(function () {
  'use strict';
  const TT = (globalThis.TT = globalThis.TT || {});
  if (TT.makeUI) return;

  const CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.b { position: fixed; pointer-events: auto; cursor: pointer; box-sizing: border-box; white-space: nowrap; line-height: 1.25; }
.b[hidden], .quiet .b { display: none; }

.fake {
  color: #d3221a; background: rgba(255,255,255,.62); border: .09em solid currentColor; border-radius: .16em;
  box-shadow: inset 0 0 0 .05em rgba(255,255,255,.85), inset 0 0 0 .1em rgba(211,34,26,.8), 0 .1em .45em rgba(140,10,10,.3);
  -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px); text-shadow: 0 0 .12em #fff;
  padding: .16em .5em .2em; text-align: center; transform: translate(-50%, -50%) rotate(-8deg);
  font-weight: 900; letter-spacing: .06em; text-transform: uppercase;
}
.fake .w { display: block; font-size: 1em; line-height: 1; }
.fake .s { display: block; font-size: .4em; letter-spacing: .04em; margin-top: .18em; font-weight: 800; }
.fake.slam { animation: slam .42s cubic-bezier(.2,.9,.3,1.25) both; }
@keyframes slam {
  0% { transform: translate(-50%, -50%) rotate(-14deg) scale(2.6); opacity: 0; }
  55% { transform: translate(-50%, -50%) rotate(-7deg) scale(.9); opacity: 1; }
  75% { transform: translate(-50%, -50%) rotate(-9deg) scale(1.04); }
  100% { transform: translate(-50%, -50%) rotate(-8deg) scale(1); }
}

.chip { font-size: 11.5px; font-weight: 700; padding: 2px 7px; border-radius: 5px; border: 1px solid; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
.warn { background: #fff3d1; border-color: #e9a915; color: #6b4300; }
.ok { background: #e8f6ed; border-color: #93cfa6; color: #17613a; font-weight: 600; }
.watch { background: rgba(245,246,248,.94); border-color: #d4d9df; color: #5b6570; font-weight: 600; font-size: 10.5px; }

.card {
  position: fixed; pointer-events: auto; max-width: 340px; background: #fff; color: #1d232a;
  border: 1px solid #dfe3e8; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.18);
  padding: 10px 12px; font-size: 12.5px; line-height: 1.45; white-space: normal;
}
.card h4 { margin: 0 0 4px; font-size: 13px; }
.card ul { margin: 4px 0 0; padding-left: 16px; }
.card li { margin: 1px 0; }
.card .src { margin-top: 6px; color: #7a838d; font-size: 11px; }

.hud {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%); pointer-events: auto;
  width: min(440px, calc(100vw - 24px)); box-sizing: border-box; border-radius: 14px; overflow: hidden;
  background: #121821; color: #f2f5f8; box-shadow: 0 14px 40px rgba(0,0,0,.35); font-size: 14px; line-height: 1.4;
  animation: drop .25s ease-out both;
}
@keyframes drop { from { transform: translate(-50%, -12px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
.hud .top { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 0; font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: #9aa6b2; font-weight: 700; }
.hud .x { all: unset; cursor: pointer; color: #9aa6b2; font-size: 18px; line-height: 1; padding: 0 2px; }
.hud .main { padding: 6px 14px 13px; }
.hud .big { font-size: 22px; font-weight: 850; letter-spacing: -.01em; }
.hud .dots { display: flex; gap: 6px; margin: 9px 0 6px; }
.hud .dot { flex: 1; height: 6px; border-radius: 3px; background: #2b3542; }
.hud .dot.on { background: #f2f5f8; }
.hud .dot.hit { background: #ff4d42; }
.hud .note { color: #c4ced8; font-size: 13.5px; }
.hud .hit-n { color: #ff6b62; font-weight: 800; }
.hud.v-fake .big { color: #ff4d42; font-size: 30px; letter-spacing: .02em; }
.hud.v-ok .big { color: #6be29a; }
.hud.v-warn .big { color: #ffc94a; }
.hud ul { margin: 6px 0 0; padding-left: 18px; color: #dde4ea; }
.hud li { margin: 2px 0; }

@media (prefers-color-scheme: dark) {
  .card { background: #1b2027; color: #e6eaef; border-color: #333b45; }
  .card .src { color: #8b95a0; }
}
`;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  TT.makeUI = function makeUI() {
    let host = null, root = null, layer = null, card = null, hudNode = null;
    const badges = new Map();   // key -> { node, target, v }
    let quiet = false;
    let raf = 0, tick = 0;

    function mount() {
      if (host && host.isConnected) return;
      host = document.createElement('timertruth-layer');
      host.setAttribute('data-tt', '');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;';
      root = host.attachShadow({ mode: 'open' });
      const style = el('style');
      style.textContent = CSS;
      layer = el('div', 'layer');
      root.append(style, layer);
      document.documentElement.appendChild(host);
    }

    // A block element stretches to its container; its text usually does not.
    // Measure the text itself so a chip lands right after the words.
    function rightOfText(target, r) {
      try {
        const range = document.createRange();
        range.selectNodeContents(target);
        const tr = range.getBoundingClientRect();
        if (tr.width) return Math.min(r.right, tr.right);
      } catch { /* detached */ }
      return r.right;
    }

    function place() {
      raf = 0;
      for (const b of badges.values()) {
        const r = b.target.isConnected ? b.target.getBoundingClientRect() : null;
        if (!r || (!r.width && !r.height) || r.bottom < -60 || r.top > innerHeight + 60) { b.node.hidden = true; continue; }
        b.node.hidden = false;
        if (b.v.level === 'fake') {
          // Big enough to read on a phone screen recording, never wider than the page.
          const size = Math.max(20, Math.min(56, Math.max(r.height * 1.05, r.width * 0.26), innerWidth / 7));
          b.node.style.fontSize = `${size}px`;
          b.node.style.left = `${r.left + r.width / 2}px`;
          b.node.style.top = `${r.top + r.height / 2}px`;
        } else {
          // Beside the element when there is room, so the shop's own words stay readable;
          // otherwise just above it.
          const w = b.node.offsetWidth || 120, h = b.node.offsetHeight || 20;
          const textRight = rightOfText(b.target, r);
          if (textRight + 8 + w <= innerWidth - 4) {
            b.node.style.left = `${textRight + 8}px`;
            b.node.style.top = `${r.top + (r.height - h) / 2}px`;
          } else {
            const top = r.top - h - 4 >= 2 ? r.top - h - 4 : r.bottom + 4;
            b.node.style.left = `${Math.max(2, Math.min(r.left, innerWidth - w - 4))}px`;
            b.node.style.top = `${top}px`;
          }
        }
      }
      if (card && card._for) {
        const b = badges.get(card._for);
        if (!b || b.node.hidden) { closeCard(); return; }
        const r = b.node.getBoundingClientRect();
        card.style.left = `${Math.max(6, Math.min(r.left, innerWidth - card.offsetWidth - 6))}px`;
        card.style.top = `${r.bottom + 8 + card.offsetHeight > innerHeight ? Math.max(6, r.top - card.offsetHeight - 8) : r.bottom + 8}px`;
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });

    function loop(on) {
      if (on && !tick) tick = setInterval(schedule, 250);   // layout shifts that fire no event
      if (!on && tick) { clearInterval(tick); tick = 0; }
    }

    function closeCard() { if (card) card.remove(); card = null; }

    function openCard(key) {
      const b = badges.get(key);
      if (!b) return;
      if (card && card._for === key) { closeCard(); return; }
      closeCard();
      card = el('div', 'card');
      card._for = key;
      card.append(el('h4', null, b.v.title));
      if (b.v.lines.length) {
        const ul = el('ul');
        for (const l of b.v.lines) ul.append(el('li', null, l));
        card.append(ul);
      }
      card.append(el('div', 'src', 'TimerTruth · recorded on this device only'));
      layer.append(card);
      place();
    }

    function badgeNode(v) {
      if (v.level === 'fake') {
        const n = el('div', 'b fake');
        n.append(el('span', 'w', v.badge), el('span', 's', v.sub));
        return n;
      }
      return el('div', `b chip ${v.level}`, v.badge);
    }

    /* list: [{ key, el, v, slam? }] - the full set to show; anything not in it is removed. */
    function render(list) {
      mount();
      const keep = new Set();
      for (const { key, el: target, v, slam } of list) {
        keep.add(key);
        const old = badges.get(key);
        const sig = `${v.level}|${v.badge}|${v.sub}`;
        if (old && old.sig === sig) { old.target = target; old.v = v; continue; }
        if (old) old.node.remove();
        const node = badgeNode(v);
        node.title = v.title;
        node.addEventListener('click', (e) => { e.stopPropagation(); openCard(key); });
        // Stamp it down when it newly becomes FAKE (or was FAKE but not shown yet).
        if (v.level === 'fake' && (slam || !old || old.v.level !== 'fake')) node.classList.add('slam');
        layer.append(node);
        badges.set(key, { node, target, v, sig });
      }
      for (const [key, b] of badges) if (!keep.has(key)) { b.node.remove(); badges.delete(key); }
      loop(badges.size > 0);
      place();
    }

    function setQuiet(on) {
      quiet = on;
      mount();
      layer.classList.toggle('quiet', on);
      if (!on) {
        // Replay the stamp for everything FAKE now that the test is over.
        for (const b of badges.values()) {
          if (b.v.level !== 'fake') continue;
          b.node.classList.remove('slam');
          void b.node.offsetWidth;
          b.node.classList.add('slam');
        }
        place();
      }
    }

    /* The panel shown during and after "Test this timer".
     *   { mode: 'progress', step, total, resets, checking }
     *   { mode: 'verdict', level, headline, lines }
     *   null to remove
     */
    function hud(s) {
      mount();
      if (hudNode) hudNode.remove();
      hudNode = null;
      if (!s) return;
      const n = el('div', 'hud');
      const top = el('div', 'top');
      const x = el('button', 'x', '×');
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', () => hud(null));
      top.append(el('span', null, s.mode === 'verdict' ? 'TimerTruth · verdict' : 'TimerTruth · testing this timer'), x);
      const main = el('div', 'main');
      if (s.mode === 'progress') {
        main.append(el('div', 'big', s.step ? `Reload ${s.step} of ${s.total}` : 'Reading the timer'));
        const dots = el('div', 'dots');
        for (let i = 1; i <= s.total; i++) {
          const cls = i <= (s.resets || 0) ? 'dot hit' : i <= s.step ? 'dot on' : 'dot';
          dots.append(el('div', cls));
        }
        main.append(dots);
        const note = el('div', 'note');
        if (s.checking || !s.step) note.textContent = s.step ? 'Reading the timer again…' : 'Then reloading the page 3 times.';
        else if (s.resets) { note.append('Timer reset caught: '); note.append(el('span', 'hit-n', `${s.resets}×`)); }
        else note.textContent = s.timers ? 'Deadline held so far.' : 'No live countdown seen yet.';
        main.append(note);
      } else {
        n.classList.add(`v-${s.level}`);
        main.append(el('div', 'big', s.headline));
        if (s.lines && s.lines.length) {
          const ul = el('ul');
          for (const l of s.lines.slice(0, 4)) ul.append(el('li', null, l));
          main.append(ul);
        }
      }
      n.append(top, main);
      layer.append(n);
      hudNode = n;
    }

    function clear() {
      for (const b of badges.values()) b.node.remove();
      badges.clear();
      closeCard();
      hud(null);
      loop(false);
    }

    document.addEventListener('click', (e) => { if (card && !e.composedPath().includes(layer)) closeCard(); }, true);

    return { render, hud, setQuiet, clear, get quiet() { return quiet; } };
  };
})();
