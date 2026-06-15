#!/usr/bin/env node
// Regenerate the extension PNG icons.
// Usage: node brand/generate-icons.mjs   (requires `sharp`: npm install --no-save sharp)
//
// 48px and 128px are derived from the rich master photograph (app-icon.png).
// 16px is rendered from a dedicated SIMPLIFIED vector (app-icon-16.svg) -- bold
// gold shield rim, navy centre, a single QRS pulse spike + beacon -- because the
// fine detail of the full master collapses to a blob at favicon size.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// 48 / 128 from the master raster
for (const size of [48, 128]) {
  const out = join(root, 'icons', `icon-${size}.png`);
  await sharp(join(here, 'app-icon.png')).resize(size, size).png().toFile(out);
  console.log(`wrote icons/icon-${size}.png (master)`);
}

// 16 from the simplified favicon vector
const fav = readFileSync(join(here, 'app-icon-16.svg'));
await sharp(fav, { density: 384 }).resize(16, 16).png().toFile(join(root, 'icons', 'icon-16.png'));
console.log('wrote icons/icon-16.png (simplified)');
