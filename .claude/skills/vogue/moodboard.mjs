/* global process, console, URL */
// Vogue Stage-3 mood board — renders the suite's key surfaces with each
// candidate season's token overrides layered on, in light AND dark, so the
// directions can be SEEN side by side before a pick.
//
// Usage:
//   node .claude/skills/vogue/moodboard.mjs [seasonsDir] [outDir]
//     seasonsDir  dir of <slug>.css token-override files  (default /tmp/vogue/seasons)
//     outDir      where PNGs are written                  (default /tmp/vogue)
//
// Writes:
//   <outDir>/baseline-<surface>-<theme>.png        (current season, no override)
//   <outDir>/<slug>-<surface>-<theme>.png          (one set per season css file)
//
// Each season css file is a normal stylesheet — typically :root { … } and
// [data-theme="dark"] { … } token overrides — appended LAST after first paint,
// so equal-specificity rules win and the real theme code path still runs.
// Reuses Atelier's chrome.* shim so themes apply through the product code.
//
// Requires: npx playwright install chromium

import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { extname, join, resolve, basename } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../..');
const SEASONS_DIR = process.argv[2] || '/tmp/vogue/seasons';
const OUT = process.argv[3] || '/tmp/vogue';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

// Representative surfaces: the panel shell (the suite's face) and the options
// page (dense content + forms). Add more here if a season needs judging on a
// specific module.
const SURFACES = [
  { name: 'panel', path: '/side-panel/panel.html', width: 400, height: 860 },
  { name: 'options', path: '/options/options.html', width: 1280, height: 900 },
];

function chromeShim(theme) {
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
        id: 'vogue-shim',
        getURL: (p) => '/' + String(p).replace(/^\\//, ''),
        getManifest: () => ({ version: '0.0.0-vogue' }),
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

async function loadSeasons() {
  let files = [];
  try {
    files = (await readdir(SEASONS_DIR)).filter((f) => f.endsWith('.css'));
  } catch {
    console.log(`no seasons dir at ${SEASONS_DIR} — rendering baseline only`);
  }
  const seasons = [{ slug: 'baseline', css: '' }];
  for (const f of files) {
    seasons.push({ slug: basename(f, '.css'), css: await readFile(join(SEASONS_DIR, f), 'utf8') });
  }
  return seasons;
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

const seasons = await loadSeasons();
console.log(`rendering ${seasons.length} season(s) × ${SURFACES.length} surface(s) × 2 themes`);

const browser = await chromium.launch();
let failures = 0;
for (const season of seasons) {
  for (const surface of SURFACES) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: surface.width, height: surface.height } });
      const tab = await ctx.newPage();
      const errors = [];
      tab.on('pageerror', (e) => errors.push(e.message));
      await tab.addInitScript(chromeShim(theme));
      try {
        await tab.goto(`http://127.0.0.1:${port}${surface.path}`, { waitUntil: 'networkidle', timeout: 15000 });
        await tab.waitForTimeout(700); // let async first paint settle
        if (season.css) {
          // Append the season's token overrides LAST so equal-specificity
          // :root / [data-theme] rules win over the shipped canon.
          await tab.addStyleTag({ content: `/* vogue season: ${season.slug} */\n${season.css}` });
          await tab.waitForTimeout(150);
        }
        const file = join(OUT, `${season.slug}-${surface.name}-${theme}.png`);
        await tab.screenshot({ path: file, fullPage: false });
        console.log(`ok  ${file}${errors.length ? `  (page errors: ${errors.length} — expected for live-data modules)` : ''}`);
      } catch (e) {
        failures++;
        console.error(`FAIL ${season.slug}-${surface.name}-${theme}: ${e.message}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
console.log(`\nmood board → ${OUT}  (read every PNG; kill any season that buried an alert or dropped below the FLOOR)`);
process.exit(failures ? 1 : 0);
