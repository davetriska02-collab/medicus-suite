/* global process, console, URL */
// Headless renders of the Suite canvas family (problem organiser + allocate).
// Usage: node scripts/canvas-chrome-shots.mjs [outDir]
// Writes <view>.png into outDir (default /tmp/canvas-chrome).

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = process.argv[2] || '/tmp/canvas-chrome';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};

const VIEWS = ['pnc', 'lac', 'rxac', 'qac'];

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, path === '/' ? '/scripts/canvas-chrome-fixture.html' : path);
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
for (const view of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();
  try {
    await tab.goto(`http://127.0.0.1:${port}/scripts/canvas-chrome-fixture.html?view=${view}`, {
      waitUntil: 'networkidle',
      timeout: 15000,
    });
    const file = join(OUT, `${view}.png`);
    await tab.screenshot({ path: file, fullPage: false });
    console.log(`ok  ${file}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${view}: ${e.message}`);
  }
  await ctx.close();
}
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
