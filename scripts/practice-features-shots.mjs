/* global process, console, URL */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = process.argv[2] || join(ROOT, 'docs/_preview/practice-features');
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, path === '/' ? '/scripts/practice-features-fixture.html' : path);
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

async function shotPadded(page, selector, dest, pad) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`missing ${selector}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  await page.screenshot({
    path: dest,
    clip: {
      x,
      y,
      width: Math.ceil(box.width + pad * 2),
      height: Math.ceil(box.height + pad * 2),
    },
  });
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const ctx = await browser.newContext({
  viewport: { width: 820, height: 1400 },
  deviceScaleFactor: 2,
});
const tab = await ctx.newPage();
let failures = 0;
try {
  await tab.goto(`http://127.0.0.1:${port}/scripts/practice-features-fixture.html`, {
    waitUntil: 'networkidle',
    timeout: 15000,
  });
  await tab.locator('#sect-practice-features').waitFor();
  await shotPadded(tab, '#sect-practice-features', join(OUT, 'board.png'), 16);
  console.log('ok  board.png');
  await shotPadded(tab, '#row-softFlags', join(OUT, 'toggle-off.png'), 8);
  console.log('ok  toggle-off.png');
  await shotPadded(tab, '#row-allocateCanvases', join(OUT, 'toggle-on.png'), 8);
  console.log('ok  toggle-on.png');
  await shotPadded(tab, '#row-softFlags .suite-toggle', join(OUT, 'toggle-off-switch.png'), 28);
  console.log('ok  toggle-off-switch.png');
  await shotPadded(tab, '#row-allocateCanvases .suite-toggle', join(OUT, 'toggle-on-switch.png'), 28);
  console.log('ok  toggle-on-switch.png');
} catch (e) {
  failures++;
  console.error(`FAIL: ${e.message}`);
}
await ctx.close();
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
