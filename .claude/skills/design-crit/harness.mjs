// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
/* global console, URL */
// design-crit harness — reusable rig for rendering REAL extension states
// headlessly so critics judge pixels, not CSS in the abstract.
//
// What it provides beyond .claude/skills/ui-design/screenshot.mjs (which only
// renders the static shell): a chrome.* storage shim you can SEED (practice
// code, module prefs, alert rules…) with working onChanged echo, plus
// Playwright route interception of the Medicus API so modules render with
// realistic data in any state you can fixture.
//
// Usage (from a small per-run states file, executed from the REPO ROOT so
// `playwright` resolves — copy to <repo>/.tmp-shots.mjs, run, delete):
//
//   import { startServer, launch, shoot } from './.claude/skills/design-crit/harness.mjs';
//   const { port, close } = await startServer();
//   const browser = await launch();
//   await shoot(browser, port, {
//     name: 'alerting-light', theme: 'light', out: '/tmp/ui-design/myreview',
//     store: { 'panel.activeModule': 'slots', 'slots.alertRules': [...] },
//     apiFixture: (url) => ({ ...json for this endpoint... }),   // or null
//     actions: async (tab) => { await tab.click('#something'); },// optional
//   });
//   await browser.close(); close();

'use strict';

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../..');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// Serve the repo over localhost so extension pages load without chrome://.
export async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = join(ROOT, p === '/' ? '/side-panel/panel.html' : p);
      if (!f.startsWith(ROOT)) throw new Error('traversal');
      const body = await readFile(f);
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => server.close() };
}

export function launch() {
  return chromium.launch();
}

// chrome.* shim with a seedable store and a WORKING onChanged echo (writes
// notify listeners in-page, so live-apply flows render truthfully).
// Suppresses the tour by default so it doesn't cover the surface under review.
export function chromeShim(theme, store = {}, { suppressTour = true } = {}) {
  const seeded = { 'suite.display': { theme, size: 'medium', colorblind: false }, ...store };
  return `
    const __store = ${JSON.stringify(seeded)};
    const __listeners = [];
    const storageArea = {
      get(keys, cb) { let out = {}; if (typeof keys === 'string') out[keys] = __store[keys];
        else if (Array.isArray(keys)) keys.forEach((k) => (out[k] = __store[k]));
        else if (keys) { out = { ...keys }; Object.keys(keys).forEach((k) => { if (k in __store) out[k] = __store[k]; }); }
        else out = { ...__store };
        if (cb) { cb(out); return; } return Promise.resolve(out); },
      set(obj, cb) { const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { newValue: v }; __store[k] = v; }
        __listeners.forEach((fn) => { try { fn(ch, 'local'); } catch (_) {} }); if (cb) cb(); return Promise.resolve(); },
      remove(k, cb) { (Array.isArray(k) ? k : [k]).forEach((x) => delete __store[x]); if (cb) cb(); return Promise.resolve(); },
    };
    const onChanged = { addListener(fn) { __listeners.push(fn); }, removeListener() {}, hasListener() { return false; } };
    const noop = { addListener() {}, removeListener() {}, hasListener() { return false; } };
    window.chrome = {
      storage: { local: storageArea, sync: storageArea, session: storageArea, onChanged },
      runtime: { id: 'crit-shim', getURL: (p) => '/' + String(p).replace(/^\\//, ''), getManifest: () => ({ version: '0' }),
        sendMessage: (...a) => { const cb = a[a.length - 1]; if (typeof cb === 'function') cb(undefined); return Promise.resolve(undefined); },
        onMessage: noop, openOptionsPage() {} },
      tabs: { query: () => Promise.resolve([]), create: () => Promise.resolve({}), sendMessage: () => Promise.resolve(undefined), onUpdated: noop, onActivated: noop },
      windows: { create: () => Promise.resolve({}), onRemoved: noop },
      scripting: { executeScript: () => Promise.resolve([{ result: false }]) },
      alarms: { create() {}, clear: () => Promise.resolve(true), onAlarm: noop },
      action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
      sidePanel: { setOptions: () => Promise.resolve() },
      permissions: { contains: (_p, cb) => { if (cb) cb(true); return Promise.resolve(true); } },
    };
    ${suppressTour ? "try { localStorage.setItem('suite.tour.seenVersion', '999'); } catch (_) {}" : ''}
  `;
}

// Render one named state to <out>/<name>.png. `apiFixture(url)` returns the
// JSON body for any intercepted *.api.england.medicus.health request.
export async function shoot(
  browser,
  port,
  {
    name,
    theme = 'light',
    out = '/tmp/ui-design/crit',
    page = '/side-panel/panel.html',
    width = 400,
    height = 900,
    store = {},
    apiFixture = null,
    actions = null,
    settleMs = 600,
    shimExtra = '', // script appended AFTER the base shim — may override window.chrome.* members (e.g. tabs.sendMessage fixtures for content-script-fed modules like Sentinel)
  }
) {
  await mkdir(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width, height } });
  // Third-party requests (webfonts, GitHub update check) are egress-blocked in
  // this sandbox and can fail SLOWLY, holding 'networkidle' hostage — abort
  // them immediately so renders are deterministic.
  await ctx.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|api\.github\.com)\//, (route) =>
    route.abort()
  );
  if (apiFixture) {
    await ctx.route('https://*.api.england.medicus.health/**', (route) => {
      const body = apiFixture(new URL(route.request().url()));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.addInitScript(chromeShim(theme, store) + '\n' + shimExtra);
  // Land on 'load' (deterministic), then give the wire a best-effort chance to
  // go quiet — networkidle alone can hang forever on pollers, and a goto
  // timeout would cancel the navigation outright.
  await tab.goto(`http://127.0.0.1:${port}${page}`, { waitUntil: 'load', timeout: 15000 });
  await tab.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await tab.waitForTimeout(settleMs);
  if (actions) await actions(tab);
  const file = join(out, `${name}.png`);
  await tab.screenshot({ path: file, fullPage: true });
  await ctx.close();
  if (errors.length) console.log(`   ${name} page errors: ${errors.join(' | ')}`);
  console.log(`ok ${file}`);
  return file;
}
