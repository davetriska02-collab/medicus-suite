/* global console */
// Renders the six Slots looks to PNGs at one fixed size.
// Usage from repo root: node docs/_preview/slots-refresh/shoot.mjs

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(import.meta.dirname);
const WIDTH = 400;
const HEIGHT = 1440;

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

const LOOKS = [
  { key: 'baseline', file: 'baseline.png' },
  { key: 'a', file: 'a.png' },
  { key: 'b', file: 'b.png' },
  { key: 'c', file: 'c.png' },
  { key: 'd', file: 'd.png' },
  { key: 'e', file: 'e.png' },
];

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = join(ROOT, p === '/' ? '/docs/_preview/slots-refresh/fixture.html' : p);
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

const { port, close } = await startServer();
const browser = await chromium.launch({ channel: 'chrome' });
await mkdir(OUT, { recursive: true });

for (const look of LOOKS) {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/docs/_preview/slots-refresh/fixture.html?look=${look.key}&shot=1`, {
    waitUntil: 'load',
    timeout: 15000,
  });
  await page.waitForTimeout(250);
  const dest = join(OUT, look.file);
  await page.screenshot({ path: dest, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  await ctx.close();
  console.log('ok', dest);
}

await browser.close();
close();
