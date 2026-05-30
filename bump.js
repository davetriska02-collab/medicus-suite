#!/usr/bin/env node
// Medicus Suite — version bump helper
//
// Bumps manifest.json `version` (and the `description` field, which mirrors it)
// and prepends a CHANGELOG.md entry, in one atomic step. This replaces the
// manual two-file edit that CLAUDE.md mandates on every pushed change and that
// was repeatedly forgotten or half-done.
//
// Usage:
//   node bump.js <patch|minor|major> "Changelog message"
//   npm run bump -- <patch|minor|major> "Changelog message"
//
// The message may contain literal "\n" sequences to split into multiple bullet
// lines. Each line becomes a "- " bullet under a single dated version heading.
//
// No dependencies; pure Node fs.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MANIFEST = path.join(ROOT, 'manifest.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function fail(msg) {
  console.error('bump: ' + msg);
  process.exit(1);
}

const level = process.argv[2];
const message = process.argv[3];

if (!['patch', 'minor', 'major'].includes(level)) {
  fail('first argument must be one of: patch | minor | major');
}
if (!message || !message.trim()) {
  fail('second argument (changelog message) is required');
}

// ---- bump manifest version ----
const manifestRaw = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(manifestRaw);
const cur = String(manifest.version || '0.0.0');
const m = cur.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) fail(`manifest version "${cur}" is not semver X.Y.Z`);
let major = Number(m[1]), minor = Number(m[2]), patch = Number(m[3]);
if (level === 'major') { major++; minor = 0; patch = 0; }
else if (level === 'minor') { minor++; patch = 0; }
else { patch++; }
const next = `${major}.${minor}.${patch}`;

manifest.version = next;
if (typeof manifest.description === 'string' && /^Medicus Suite v/.test(manifest.description)) {
  manifest.description = `Medicus Suite v${next}`;
}
// Preserve the existing single-line compact formatting of manifest.json.
const compact = !/\n\s+"/.test(manifestRaw);
fs.writeFileSync(MANIFEST, compact ? JSON.stringify(manifest) + '\n' : JSON.stringify(manifest, null, 2) + '\n');

// ---- prepend changelog entry ----
const today = new Date().toISOString().slice(0, 10);
const bullets = message.split(/\\n|\n/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n');
const entry = `## [v${next}] — ${today}\n${bullets}\n\n`;

let changelog = fs.readFileSync(CHANGELOG, 'utf8');
const firstHeading = changelog.search(/^## \[/m);
if (firstHeading === -1) {
  changelog = changelog.replace(/\s*$/, '\n\n') + entry;
} else {
  changelog = changelog.slice(0, firstHeading) + entry + changelog.slice(firstHeading);
}
fs.writeFileSync(CHANGELOG, changelog);

console.log(`bumped ${cur} -> ${next} (${level})`);
console.log('manifest.json + CHANGELOG.md updated. Remember to commit both.');
