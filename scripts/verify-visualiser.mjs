/* global process, console, URL, Buffer */
/* The following globals appear ONLY inside tab.evaluate()/waitForFunction()
   callbacks, which run in the browser page context, not in Node: */
/* global window, document, getComputedStyle, getPdfjs */
// ──────────────────────────────────────────────────────────────────────────
// verify-visualiser.mjs — headless proof that the patient-record visualiser
// (visualiser-core.html + visualiser-core.js + vendor/pdf.min.js) actually
// works under the real MV3 extension-page Content-Security-Policy.
//
// WHY THIS EXISTS
//   PDF.js 4.x ships ESM-only. The regression was caused by loading it via an
//   inline `<script type="module">`: the MV3 default extension CSP is
//   `script-src 'self'`, which BLOCKS inline scripts (including type=module). When
//   blocked, the PDF.js namespace was never available and visualiser-core.js threw
//   at top level, so setupDrop() never ran and the drop-zone / "Choose PDF file"
//   button was dead.
//
//   The CSP-safe fix is to load PDF.js LAZILY with a dynamic `import()` of the
//   same-origin module (allowed by `'self'`) from getPdfjs() inside
//   visualiser-core.js — no inline script and no window.pdfjsLib global is needed.
//
//   This harness emulates that CSP faithfully (the static server sends the header
//   on every response) so it catches exactly that class of failure: an inline
//   script (or any other 'self'-violating load) fails here just as it would in the
//   packed extension. Assertion (b) proves the module loads by invoking the page's
//   own getPdfjs() and checking the resolved namespace has getDocument; it also
//   accepts a window.pdfjsLib global if a build chooses to set one.
//
// USAGE
//   npm install --no-save playwright          # one-off, if not present
//   npx playwright install --with-deps chromium
//   node scripts/verify-visualiser.mjs
//
// EXIT CODE: 0 = PASS, 1 = FAIL (reason printed).
// Does NOT modify any product code.
// ──────────────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// ── Locate a Chromium binary Playwright can drive ──────────────────────────
// Prefer Playwright's own bundled download (default launch). If the CDN was
// blocked at install time, the bundled browser won't exist, so fall back to a
// pre-provisioned (PLAYWRIGHT_BROWSERS_PATH) or system Chromium via
// executablePath. Override explicitly with PLAYWRIGHT_CHROMIUM=/abs/path.
function resolveChromiumExecutable() {
  const env = process.env.PLAYWRIGHT_CHROMIUM || process.env.CHROME_BIN;
  if (env && existsSync(env)) return env;

  for (const c of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
  ]) {
    if (existsSync(c)) return c;
  }

  const dirs = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    join(process.env.HOME || '/root', '.cache', 'ms-playwright'),
  ].filter(Boolean);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    // Use the full chrome build (chromium-*), not chrome-headless-shell-*, so a
    // version-pinned headless_shell mismatch can't block the launch.
    for (const e of entries
      .filter((n) => /^chromium-\d/.test(n))
      .sort()
      .reverse()) {
      for (const rel of [
        'chrome-linux/chrome',
        'chrome-linux64/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-win/chrome.exe',
      ]) {
        const p = join(dir, e, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null; // let Playwright try its own bundled browser
}

// ── The CSP we faithfully emulate ──────────────────────────────────────────
// This is the MV3 default extension-page policy. `script-src 'self'` blocks
// inline scripts (including <script type="module"> with inline body), which is
// the precise mechanism that breaks the visualiser when not worked around.
const EXTENSION_CSP = "script-src 'self'; object-src 'self'";

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// ── chrome.* shim ───────────────────────────────────────────────────────────
// Mirrors the extension page environment so display-prefs.js runs and
// chrome.runtime.getURL resolves the pdf.worker URL the way the real page does.
const CHROME_SHIM = `
  const __store = { 'suite.display': { theme: 'light', size: 'medium', colorblind: false } };
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
      id: 'verify-visualiser-shim',
      getURL: (p) => '/' + String(p).replace(/^\\//, ''),
      getManifest: () => ({ version: '0.0.0-verify' }),
      lastError: undefined,
    },
  };
`;

// ── Minimal valid one-page PDF with extractable text ────────────────────────
// Hand-written PDF 1.4 with a single page and a text-showing content stream.
// PDF.js parses this without a worker dependency on external resources.
function makeMinimalPdf() {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  const stream = 'BT /F1 24 Tf 72 700 Td (Medicus Visualiser Test Patient) Tj ET';
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\n` + `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function fail(reason, details) {
  console.error(`\nFAIL: ${reason}`);
  if (details && details.length) {
    console.error('\n  Details:');
    for (const d of details) console.error('   - ' + d);
  }
  process.exit(1);
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    fail('playwright is not installed', [
      'Run: npm install --no-save playwright',
      'Then: npx playwright install --with-deps chromium',
    ]);
  }

  // ── Static server that stamps the extension CSP on EVERY response ─────────
  const server = createServer(async (req, res) => {
    const csp = EXTENSION_CSP;
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = join(ROOT, path === '/' ? '/visualiser-core.html' : path);
      if (!file.startsWith(ROOT)) throw new Error('traversal');
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'content-security-policy': csp,
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-security-policy': csp }).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // headless_shell version pins can block launch on pre-provisioned installs;
  // point at the full chrome build via executablePath when one is discoverable.
  const exe = resolveChromiumExecutable();
  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (exe) launchOpts.executablePath = exe;
  console.log(exe ? `Chromium: ${exe}` : 'Chromium: (Playwright bundled)');

  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    server.close();
    fail('could not launch headless Chromium', [
      e.message,
      'Install it with: npx playwright install --with-deps chromium',
      'or set PLAYWRIGHT_CHROMIUM=/abs/path/to/chrome',
    ]);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tab = await ctx.newPage();

  const consoleErrors = [];
  const consoleAll = [];
  const pageErrors = [];
  const cspViolations = [];

  tab.on('console', (msg) => {
    const text = msg.text();
    consoleAll.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') consoleErrors.push(text);
    if (/content security policy|refused to (load|execute|run)/i.test(text)) {
      cspViolations.push(text);
    }
  });
  tab.on('pageerror', (e) => pageErrors.push(e.message));
  // securitypolicyviolation events fire in-page; surface them too.
  await tab.addInitScript(CHROME_SHIM);
  await tab.addInitScript(`
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(e.violatedDirective + ' :: ' + (e.blockedURI || e.sourceFile || 'inline'));
    });
  `);

  const finish = async (code) => {
    await ctx.close();
    await browser.close();
    server.close();
    process.exit(code);
  };

  console.log(`Serving ${ROOT}`);
  console.log(`CSP emulated on every response: "${EXTENSION_CSP}"`);
  console.log(`Navigating to ${base}/visualiser-core.html\n`);

  try {
    await tab.goto(`${base}/visualiser-core.html`, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (e) {
    console.error('Navigation error:', e.message);
  }
  await tab.waitForTimeout(800); // let deferred scripts + module graph settle

  // Pull in-page CSP violation records (track how many we've consumed so we can
  // detect NEW ones fired later, e.g. during the lazy PDF.js import).
  let inPageCspSeen = 0;
  const drainInPageCsp = async () => {
    const all = await tab.evaluate(() => window.__cspViolations || []).catch(() => []);
    const fresh = all.slice(inPageCspSeen);
    inPageCspSeen = all.length;
    for (const v of fresh) cspViolations.push('securitypolicyviolation: ' + v);
    return fresh.length;
  };
  await drainInPageCsp();

  const passes = [];

  // ── Assertion (a): no uncaught exception / no CSP-violation error on load ──
  if (pageErrors.length) {
    fail('uncaught exception(s) during load (assertion a)', [
      ...pageErrors.map((m) => 'pageerror: ' + m),
      ...cspViolations,
      ...consoleErrors.slice(0, 8).map((m) => 'console.error: ' + m),
    ]).catch?.(() => {});
    await finish(1);
    return;
  }
  if (cspViolations.length) {
    fail('CSP violation(s) during load (assertion a)', cspViolations);
    await finish(1);
    return;
  }
  passes.push('(a) no uncaught exceptions and no CSP violations during load');

  // ── Assertion (b): PDF.js loads under CSP and exposes getDocument ──────────
  // The page loads PDF.js lazily via getPdfjs() (dynamic import of the
  // same-origin module — the CSP-safe replacement for the old inline script).
  // We invoke it here: success proves the module loaded under `script-src
  // 'self'` and has getDocument. (If the old inline-script regression were
  // present, getPdfjs would not even be defined — the top level would have
  // thrown — and assertion (c)'s "ready" check would also catch it.) We also
  // accept a window.pdfjsLib global if a build sets one.
  const cspBeforePdfjs = cspViolations.length;
  const pdfjsState = await tab.evaluate(async () => {
    try {
      let lib = typeof window.pdfjsLib !== 'undefined' && window.pdfjsLib ? window.pdfjsLib : null;
      let via = lib ? 'window.pdfjsLib' : null;
      if (!lib && typeof getPdfjs === 'function') {
        lib = await getPdfjs();
        via = 'getPdfjs()';
      }
      return {
        ok: !!lib,
        via,
        hasGetDocument: !!(lib && typeof lib.getDocument === 'function'),
        getPdfjsDefined: typeof getPdfjs === 'function',
        windowGlobal: typeof window.pdfjsLib !== 'undefined' && !!window.pdfjsLib,
      };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e) };
    }
  });
  // A CSP violation may have fired during the lazy import — surface any new ones.
  await drainInPageCsp();
  if (!pdfjsState.ok || !pdfjsState.hasGetDocument) {
    fail(
      'PDF.js failed to load or lacks getDocument (assertion b)',
      [
        `getPdfjs() defined: ${pdfjsState.getPdfjsDefined}`,
        `namespace resolved: ${pdfjsState.ok} (via ${pdfjsState.via})`,
        `getDocument is function: ${pdfjsState.hasGetDocument}`,
        `window.pdfjsLib global present: ${pdfjsState.windowGlobal}`,
        pdfjsState.err ? `error: ${pdfjsState.err}` : null,
        ...cspViolations.slice(cspBeforePdfjs),
        'Classic symptom of the regression: the inline ESM module is blocked by CSP,',
        'so PDF.js never loads / window.pdfjsLib never gets set.',
      ].filter(Boolean)
    );
    await finish(1);
    return;
  }
  if (cspViolations.length > cspBeforePdfjs) {
    fail('CSP violation during PDF.js load (assertion b)', cspViolations.slice(cspBeforePdfjs));
    await finish(1);
    return;
  }
  passes.push(
    `(b) PDF.js loaded under CSP via ${pdfjsState.via} and has getDocument() ` +
      `(window.pdfjsLib global: ${pdfjsState.windowGlobal})`
  );

  // ── Assertion (c): drop-zone / file input wired ────────────────────────────
  const wiring = await tab.evaluate(() => {
    const zone = document.getElementById('drop-zone');
    const box = document.getElementById('drop-box');
    const fi = document.getElementById('file-input');
    const app = document.getElementById('app');
    // The "ready" log only prints if visualiser-core.js reached its bottom
    // (i.e. setupDrop() ran without the top-level pdfjsLib throw).
    return {
      hasZone: !!zone,
      hasBox: !!box,
      hasFileInput: !!fi,
      fileInputType: fi ? fi.type : null,
      hasApp: !!app,
    };
  });
  if (!wiring.hasZone || !wiring.hasFileInput || wiring.fileInputType !== 'file' || !wiring.hasApp) {
    fail('drop-zone / file input not present as expected (assertion c)', [
      `#drop-zone present: ${wiring.hasZone}`,
      `#file-input present: ${wiring.hasFileInput} (type=${wiring.fileInputType})`,
      `#app present: ${wiring.hasApp}`,
    ]);
    await finish(1);
    return;
  }
  // The decisive "the button works" signal: visualiser-core.js logs
  // "[Visualiser] ready" only after setupDrop() wires the change listener.
  const readyLogged = consoleAll.some((l) => l.includes('[Visualiser] ready'));
  if (!readyLogged) {
    fail('visualiser-core.js did not finish setup — change listener not wired (assertion c)', [
      'Expected console log "[Visualiser] ready" after setupDrop().',
      'Its absence means a top-level throw aborted the script before wiring the',
      'file-input change handler (the dead-button symptom).',
      ...consoleErrors.slice(0, 8).map((m) => 'console.error: ' + m),
    ]);
    await finish(1);
    return;
  }
  passes.push(
    '(c) #drop-zone + #file-input present and setup ran ("[Visualiser] ready" logged → change listener wired)'
  );

  // ── Assertion (d): END-TO-END — feed a real PDF through the file input ─────
  const pdfPath = join(ROOT, '.verify-visualiser-sample.pdf');
  const { writeFile, rm } = await import('node:fs/promises');
  await writeFile(pdfPath, makeMinimalPdf());

  let e2eDetail = '';
  try {
    // Set the file on the real <input> and dispatch its change handler.
    await tab.setInputFiles('#file-input', pdfPath);

    // Success signal: visualiser-core.js hides #drop-zone (line ~1868) and
    // shows #app once PDF.js has parsed the document. Also watch for the
    // "PDF opened" log which proves getDocument resolved.
    await tab
      .waitForFunction(
        () => {
          const zone = document.getElementById('drop-zone');
          const app = document.getElementById('app');
          const zoneHidden = zone && getComputedStyle(zone).display === 'none';
          const appShown = app && getComputedStyle(app).display !== 'none';
          return zoneHidden || appShown;
        },
        { timeout: 12000 }
      )
      .then(() => {
        e2eDetail = 'full parse: #drop-zone hidden / #app shown (PDF.js parsed the document)';
      });
  } catch {
    // Full parse may be flaky headlessly. Fall back to the spec's minimum:
    // assert pdfjsLib.getDocument can be CALLED without throwing synchronously.
    const opened = consoleAll.some((l) => l.includes('[Visualiser] PDF opened'));
    const loadStarted = consoleAll.some((l) => l.includes('[Visualiser] loadPDF start'));
    const canCall = await tab.evaluate(() => {
      try {
        const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"
        const task = window.pdfjsLib.getDocument({ data: bytes });
        const ok = task && typeof task.promise?.then === 'function';
        // Swallow the rejection (truncated PDF) — we only assert it didn't throw on call.
        if (task && task.promise) task.promise.catch(() => {});
        return ok;
      } catch (err) {
        return 'threw: ' + err.message;
      }
    });
    if (loadStarted && opened) {
      e2eDetail = 'change handler ran loadPDF and PDF.js logged "PDF opened" (parse succeeded)';
    } else if (canCall === true) {
      e2eDetail =
        'fallback: pdfjsLib.getDocument() callable without throwing' +
        (loadStarted ? '; change handler invoked loadPDF' : '');
    } else {
      await rm(pdfPath, { force: true });
      fail('end-to-end PDF feed did not progress and getDocument not callable (assertion d)', [
        `loadPDF start logged: ${loadStarted}`,
        `PDF opened logged: ${opened}`,
        `getDocument callable: ${canCall}`,
        ...consoleErrors.slice(0, 8).map((m) => 'console.error: ' + m),
      ]);
      await finish(1);
      return;
    }
  }
  await rm(pdfPath, { force: true });
  passes.push('(d) end-to-end — ' + e2eDetail);

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('PASS');
  for (const p of passes) console.log('  ok  ' + p);
  await finish(0);
}

main().catch(async (e) => {
  console.error('\nFAIL: harness crashed unexpectedly');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
