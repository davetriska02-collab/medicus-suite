#!/usr/bin/env node
// Regenerate the brand PNGs from the SVG masters.
// Usage: node brand/generate-icons.mjs   (requires `sharp`: npm install --no-save sharp)
//
// Source of truth is now vector:
//   app-icon-master.svg  -> brand/app-icon.png (512), icons/icon-48.png, icon-128.png
//   app-icon-16.svg      -> icons/icon-16.png  (simplified — detail collapses at 16px)
// The mark: a deep-navy instrument bezel, a gold precision reticle (outer ring +
// four cardinal index ticks + inner ring) and a cyan "live lock" beacon at the
// crosshair centre — the recurring focal element. See brand/BRAND.md.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const master = readFileSync(join(here, 'app-icon-master.svg'));
const fav = readFileSync(join(here, 'app-icon-16.svg'));

// 512 master raster (used by in-product <img src="brand/app-icon.png">)
await sharp(master, { density: 512 }).resize(512, 512).png().toFile(join(here, 'app-icon.png'));
console.log('wrote brand/app-icon.png (512, from master svg)');

// 48 / 128 extension icons from the master
for (const size of [48, 128]) {
  await sharp(master, { density: 512 }).resize(size, size).png().toFile(join(root, 'icons', `icon-${size}.png`));
  console.log(`wrote icons/icon-${size}.png (master)`);
}

// 16 from the simplified favicon vector
await sharp(fav, { density: 384 }).resize(16, 16).png().toFile(join(root, 'icons', 'icon-16.png'));
console.log('wrote icons/icon-16.png (simplified)');
