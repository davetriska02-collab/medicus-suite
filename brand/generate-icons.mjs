#!/usr/bin/env node
// Regenerate the extension PNG icons from the master app icon.
// Usage: node brand/generate-icons.mjs   (requires `sharp`: npm install --no-save sharp)
//
// brand/app-icon.png is the 512px master (rounded-corner Corinthian operator
// mark). Everything else is derived from it so the icon stays consistent.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const master = join(here, 'app-icon.png');

for (const size of [16, 48, 128]) {
  const out = join(root, 'icons', `icon-${size}.png`);
  await sharp(master).resize(size, size).png().toFile(out);
  console.log(`wrote icons/icon-${size}.png`);
}
