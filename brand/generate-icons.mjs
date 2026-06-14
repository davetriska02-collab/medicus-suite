#!/usr/bin/env node
// Regenerate the extension PNG icons from the brand SVG marks.
// Usage: node brand/generate-icons.mjs   (requires `sharp`: npm install --no-save sharp)
//
// 16px uses the simplified mark (logo-mark-small.svg) so the pulse + dot stay
// legible; 48px and 128px use the full mark with halo + inner rim.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const full = readFileSync(join(here, 'logo-mark.svg'));
const small = readFileSync(join(here, 'logo-mark-small.svg'));

const targets = [
  { size: 16, svg: small },
  { size: 48, svg: full },
  { size: 128, svg: full },
];

for (const { size, svg } of targets) {
  const out = join(root, 'icons', `icon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`wrote icons/icon-${size}.png`);
}

// Brand previews (transparent PNGs) for docs/store listings.
await sharp(full, { density: 384 }).resize(512, 512).png().toFile(join(here, 'logo-mark-512.png'));
console.log('wrote brand/logo-mark-512.png');
await sharp(readFileSync(join(here, 'logo-wordmark.svg')), { density: 384 })
  .resize(1000, 264, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(join(here, 'logo-wordmark-1000.png'));
console.log('wrote brand/logo-wordmark-1000.png');
