// Copies src/ into dist/chrome and dist/firefox, adapts the manifest per browser, checks it, and
// zips both. Also writes dist/timertruth.user.js for Tampermonkey, Violentmonkey and Greasy Fork
// from the same files, with userscript/platform.js in place of the extension's storage shim.
// No background script, so only Firefox's gecko settings differ.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const base = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));

const targets = {
  chrome: base,
  firefox: {
    ...base,
    // Firefox Add-ons caps names at 50 characters; the store title lives in the name on both stores.
    name: 'TimerTruth: fake sale timer detector',
    browser_specific_settings: {
      gecko: { id: 'timertruth@jju1s', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
    },
  },
};

function check(name, m, dir) {
  const files = [
    ...Object.values(m.icons), ...Object.values(m.action.default_icon), m.action.default_popup,
    ...m.content_scripts.flatMap(c => [...c.js, ...(c.css || [])]),
  ];
  const missing = files.filter(f => !fs.existsSync(path.join(dir, f)));
  const problems = [
    ...missing.map(f => `points at missing file ${f}`),
    m.manifest_version !== 3 && 'manifest_version must be 3',
    m.name.length > (name === 'firefox' ? 50 : 75) && 'name is too long for the store',
    m.description.length > 132 && 'description is over 132 characters',
    !/^\d+(\.\d+){0,3}$/.test(m.version) && 'version is not dotted numbers',
    (m.permissions || []).some(p => !['storage', 'activeTab', 'scripting'].includes(p)) && 'unexpected permission',
    // Host access is exactly the listed shops: anything else is asked for per site, on click.
    JSON.stringify(m.host_permissions) !== JSON.stringify(m.content_scripts[0].matches) && 'host_permissions must equal the content script matches',
    JSON.stringify(m.optional_host_permissions) !== JSON.stringify(['https://*/*', 'http://*/*']) && 'unexpected optional_host_permissions',
  ].filter(Boolean);
  if (problems.length) throw new Error(`${name} manifest: ${problems.join('; ')}`);
}

// Minimal deflate zip with fixed timestamps, so the same source gives the same bytes.
function zip(dir) {
  const files = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  };
  walk(dir);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(path.relative(dir, file).split(path.sep).join('/'));
    const data = fs.readFileSync(file);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(8, 8);        // deflate
    local.writeUInt16LE(0x21, 12);    // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// The userscript: same content-script files in the same order, the storage shim swapped, wrapped
// so a shop's own global `module`, `require` or `define` (AliExpress ships RequireJS) is never seen.
function userscript() {
  const files = base.content_scripts[0].js.map(f => (f === 'platform.js'
    ? path.join(root, 'userscript', 'platform.js')
    : path.join(src, f)));
  const header = [
    '// ==UserScript==',
    '// @name         TimerTruth: fake sale timer detector',
    '// @namespace    https://github.com/cig13zs/timertruth',
    `// @version      ${base.version}`,
    '// @description  Catches sale countdowns that restart when you reload, and made-up "people viewing" and "only 3 left" counts. Everything stays on your device.',
    '// @author       jju1s',
    '// @license      MIT',
    '// @homepageURL  https://github.com/cig13zs/timertruth',
    '// @supportURL   https://github.com/cig13zs/timertruth/issues',
    '// @icon         https://raw.githubusercontent.com/cig13zs/timertruth/main/src/icons/icon48.png',
    ...base.content_scripts[0].matches.map(m => `// @match        ${m}`),
    '// @grant        GM_getValue',
    '// @grant        GM_setValue',
    '// @grant        GM_deleteValue',
    '// @grant        GM_listValues',
    '// @grant        GM_registerMenuCommand',
    '// @grant        GM.getValue',
    '// @grant        GM.setValue',
    '// @grant        GM.deleteValue',
    '// @grant        GM.listValues',
    '// @grant        GM.registerMenuCommand',
    '// @run-at       document-idle',
    '// @noframes',
    '// ==/UserScript==',
    '',
    '// Built from https://github.com/cig13zs/timertruth by build.mjs. To use it on another shop, add',
    '// a @match line for it in your userscript manager. It reads only the page it runs on and makes no',
    '// network requests.',
    '',
  ].join('\n');
  const body = files.map(f => `// ---- ${path.relative(root, f).split(path.sep).join('/')}\n${fs.readFileSync(f, 'utf8').trim()}\n`).join('\n');
  return `${header}(function () {\n  // eslint-disable-next-line no-unused-vars\n  var module, exports, require, define;\n\n${body}})();\n`;
}

fs.rmSync(dist, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = path.join(dist, name);
  fs.cpSync(src, out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  check(name, manifest, out);
  const file = path.join(dist, `timertruth-${manifest.version}-${name}.zip`);
  fs.writeFileSync(file, zip(out));
  console.log(`${name}: dist/${name}/ and ${path.relative(root, file).split(path.sep).join('/')} (${fs.statSync(file).size} bytes)`);
}
const us = path.join(dist, 'timertruth.user.js');
fs.writeFileSync(us, userscript());
console.log(`userscript: dist/timertruth.user.js (${fs.statSync(us).size} bytes)`);
