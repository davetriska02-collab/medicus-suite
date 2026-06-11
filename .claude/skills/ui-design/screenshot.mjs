/* global process, console, URL */
// Atelier verify stage — headless renders of the suite's entry points.
// Usage: node .claude/skills/ui-design/screenshot.mjs [outDir]
// Writes <page>-<theme>.png to outDir (default /tmp/ui-design/).
// Requires: npx playwright install chromium
//
// Static-shell renders only: a chrome.* shim satisfies display-prefs.js and
// storage reads, so themes apply through the real code path, but module
// content needing live Medicus data will stay empty — judge the chrome,
// strips, nav, and first-paint module CSS.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = process.argv[2] || '/tmp/ui-design';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

const PAGES = [
  { name: 'panel', path: '/side-panel/panel.html', width: 400, height: 860 },
  { name: 'popout', path: '/pop-out/pop-out.html', width: 520, height: 860 },
  { name: 'options', path: '/options/options.html', width: 1280, height: 900 },
  { name: 'visualiser', path: '/visualiser-core.html', width: 1280, height: 900 },
];

function chromeShim(theme) {
  // Serialized into the page before any script runs.
  return `
    const __store = { 'suite.display': { theme: '${theme}', size: 'medium', colorblind: false } };
    const storageArea = {
      get(keys, cb) {
        let out = {};
        if (keys == null) out = { ...__store };
        else if (typeof keys === 'string') out[keys] = __store[keys];
        else if (Array.isArray(keys)) keys.forEach((k) => (out[k] = __store[k]));
        else { out = { ...keys }; Object.keys(keys).forEach((k) => { if (k in __store) out[k] = __store[k]; }); }
        if (cb) { cb(out); return undefined; }
        return Promise.resolve(out);
      },
      set(obj, cb) { Object.assign(__store, obj); if (cb) cb(); return Promise.resolve(); },
      remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete __store[k]); if (cb) cb(); return Promise.resolve(); },
    };
    const noopEvent = { addListener() {}, removeListener() {}, hasListener() { return false; } };
    window.chrome = {
      storage: { local: storageArea, sync: storageArea, session: storageArea, onChanged: noopEvent },
      runtime: {
        id: 'atelier-shim',
        getURL: (p) => '/' + String(p).replace(/^\\//, ''),
        getManifest: () => ({ version: '0.0.0-atelier' }),
        sendMessage: (...a) => { const cb = a[a.length - 1]; if (typeof cb === 'function') cb(undefined); return Promise.resolve(undefined); },
        onMessage: noopEvent, onConnect: noopEvent, connect: () => ({ onMessage: noopEvent, onDisconnect: noopEvent, postMessage() {} }),
        lastError: undefined,
      },
      tabs: { query: () => Promise.resolve([]), create: () => Promise.resolve({}), sendMessage: () => Promise.resolve(undefined), onUpdated: noopEvent, onActivated: noopEvent },
      windows: { create: () => Promise.resolve({}), onRemoved: noopEvent },
      alarms: { create() {}, clear: () => Promise.resolve(true), onAlarm: noopEvent },
      action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
      sidePanel: { setOptions: () => Promise.resolve() },
      permissions: { contains: (_p, cb) => { if (cb) cb(true); return Promise.resolve(true); } },
    };
  `;
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, path === '/' ? '/side-panel/panel.html' : path);
    if (!file.startsWith(ROOT)) throw new Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
let failures = 0;
for (const page of PAGES) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: page.width, height: page.height } });
    const tab = await ctx.newPage();
    const errors = [];
    tab.on('pageerror', (e) => errors.push(e.message));
    await tab.addInitScript(chromeShim(theme));
    try {
      await tab.goto(`http://127.0.0.1:${port}${page.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      await tab.waitForTimeout(700); // let async first paint settle
      const file = join(OUT, `${page.name}-${theme}.png`);
      await tab.screenshot({ path: file, fullPage: false });
      console.log(`ok  ${file}${errors.length ? `  (page errors: ${errors.length} — expected for live-data modules)` : ''}`);
    } catch (e) {
      failures++;
      console.error(`FAIL ${page.name}-${theme}: ${e.message}`);
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
