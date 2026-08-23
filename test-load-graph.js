// Medicus Suite — referenced-files-exist (architecture plan Phase 0.3)
// Run with: node test-load-graph.js
//
// Every path in manifest.json (content_scripts js/css, background, WAR,
// side_panel, options_page, icons) and every <script src> / <link href> in
// shipped HTML must resolve on disk. This is the prerequisite that makes
// later file-move phases fail closed instead of shipping a 404.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const ROOT = __dirname;
const SKIP_DIR = new Set(['node_modules', 'vendor', '.git', 'docs', 'brand']);

function listFiles(absDir, pred) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
      out.push(...listFiles(full, pred));
    } else if (entry.isFile() && pred(entry.name, full)) {
      out.push(full);
    }
  }
  return out;
}

function relPosix(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function existsRepoPath(rel) {
  if (!rel || rel.startsWith('http') || rel.startsWith('data:') || rel.startsWith('#')) return true;
  const clean = rel.split('?')[0].split('#')[0];
  if (!clean || clean.startsWith('chrome-extension:')) return true;
  return fs.existsSync(path.join(ROOT, ...clean.split('/')));
}

// ── manifest.json ────────────────────────────────────────────────────────────

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const manifestRefs = [];
if (manifest.background && manifest.background.service_worker) {
  manifestRefs.push({ from: 'manifest.background.service_worker', rel: manifest.background.service_worker });
}
if (manifest.side_panel && manifest.side_panel.default_path) {
  manifestRefs.push({ from: 'manifest.side_panel.default_path', rel: manifest.side_panel.default_path });
}
if (manifest.options_page) {
  manifestRefs.push({ from: 'manifest.options_page', rel: manifest.options_page });
}
for (const [size, rel] of Object.entries((manifest.action && manifest.action.default_icon) || {})) {
  manifestRefs.push({ from: `manifest.action.default_icon.${size}`, rel });
}
for (const [size, rel] of Object.entries(manifest.icons || {})) {
  manifestRefs.push({ from: `manifest.icons.${size}`, rel });
}
for (const group of manifest.content_scripts || []) {
  for (const rel of group.js || []) manifestRefs.push({ from: 'manifest.content_scripts.js', rel });
  for (const rel of group.css || []) manifestRefs.push({ from: 'manifest.content_scripts.css', rel });
}
for (const war of manifest.web_accessible_resources || []) {
  for (const rel of war.resources || []) manifestRefs.push({ from: 'manifest.web_accessible_resources', rel });
}

check(manifestRefs.length > 20, `collected ${manifestRefs.length} manifest path refs`);

const missingManifest = manifestRefs.filter((r) => !existsRepoPath(r.rel));
check(
  missingManifest.length === 0,
  missingManifest.length === 0
    ? `every manifest path resolves (${manifestRefs.length})`
    : `missing manifest paths: ${missingManifest.map((r) => r.rel).join(', ')}`
);

// ── shipped HTML <script src> / <link href> ──────────────────────────────────

const htmlFiles = listFiles(ROOT, (name) => name.endsWith('.html'));
check(htmlFiles.length >= 8, `found ${htmlFiles.length} shipped HTML files`);

const htmlMissing = [];
let htmlRefCount = 0;
for (const abs of htmlFiles) {
  const html = fs.readFileSync(abs, 'utf8');
  const dir = path.dirname(abs);
  const refs = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
    ...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi),
  ];
  for (const m of refs) {
    const raw = m[1];
    if (/^(https?:|data:|mailto:|#)/i.test(raw)) continue;
    htmlRefCount++;
    const resolved = path.resolve(dir, raw.split('?')[0]);
    if (!resolved.startsWith(ROOT) || !fs.existsSync(resolved)) {
      htmlMissing.push(`${relPosix(abs)} → ${raw}`);
    }
  }
}

check(htmlRefCount > 20, `collected ${htmlRefCount} HTML script/link refs`);
check(
  htmlMissing.length === 0,
  htmlMissing.length === 0
    ? `every HTML script/link path resolves (${htmlRefCount})`
    : `missing HTML refs:\n    ${htmlMissing.join('\n    ')}`
);

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
