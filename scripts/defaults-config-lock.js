#!/usr/bin/env node
// Medicus Suite — shipped-config version guard.
//
// defaults.json carries an integer "version" that gates mergeShippedDefaults (in BOTH
// content-scripts/triage-lens/content.js and .../options.js): the migration that
// propagates newly-shipped config to existing installs only runs when this integer is
// HIGHER than the version stored in the user's saved config. So ANY change to the
// migration-propagated content — rules / thresholds / prefs / systemChips / resultRules —
// that is NOT accompanied by a "version" bump silently fails to reach existing users.
// (This is exactly how the v3.75.0 "Urgent:" chip-label change and the bowel-screening
// rule were stranded — see CHANGELOG v3.75.2.)
//
// This guard pins a fingerprint of that content against the version:
//   node scripts/defaults-config-lock.js           # refresh the lock (after a version bump)
//   node scripts/defaults-config-lock.js --check    # CI: fail on drift, exit 1
// Refusing to refresh the lock when the content changed but the version did not is what
// forces the bump.

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DEFAULTS = path.join(ROOT, 'defaults.json');
const LOCK = path.join(__dirname, 'defaults-config.lock.json');

// Top-level keys mergeShippedDefaults propagates to existing users. A change to any of
// them needs a "version" bump to reach installs that already have a stored config.
const MIGRATION_KEYS = ['rules', 'thresholds', 'prefs', 'systemChips', 'resultRules'];

// Deterministic JSON (recursively sorted keys) so a pure key reorder doesn't churn the
// hash; array order is preserved (reordering rules IS a semantic change).
function canonical(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(k => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function fingerprint(defaults) {
  const picked = {};
  for (const k of MIGRATION_KEYS) picked[k] = defaults[k];
  return crypto.createHash('sha256').update(canonical(picked)).digest('hex');
}

const defaults = JSON.parse(fs.readFileSync(DEFAULTS, 'utf8'));
const version = defaults.version || 0;
const hash = fingerprint(defaults);
const lock = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : null;
const check = process.argv.includes('--check');

const BUMP_HINT =
  'Bump defaults.json "version" (the integer at the top — separate from the manifest semver), ' +
  'run `node scripts/regen-defaults.js`, then `node scripts/defaults-config-lock.js` to refresh the lock.';

if (check) {
  if (!lock) {
    console.error('No defaults-config lock. Run: node scripts/defaults-config-lock.js');
    process.exit(1);
  }
  if (lock.version === version && lock.hash === hash) {
    console.log(`defaults-config lock OK (version ${version}).`);
    process.exit(0);
  }
  if (lock.hash !== hash && version <= lock.version) {
    console.error(
      `defaults.json migration content (${MIGRATION_KEYS.join(' / ')}) changed but its ` +
        `"version" was NOT bumped (still ${version}). The change will not reach existing ` +
        `installs.\n${BUMP_HINT}`
    );
  } else {
    console.error(`defaults-config lock is stale (lock v${lock.version}, defaults v${version}). ` +
      'Run: node scripts/defaults-config-lock.js');
  }
  process.exit(1);
}

// Write mode — refuse to bless a content change that wasn't version-bumped.
if (lock && lock.hash !== hash && version <= lock.version) {
  console.error(`Refusing to update the lock: migration content changed but defaults.json ` +
    `"version" is still ${version} (lock is ${lock.version}).\n${BUMP_HINT}`);
  process.exit(1);
}
fs.writeFileSync(LOCK, JSON.stringify({ version, hash }, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, LOCK)} (version ${version}, hash ${hash.slice(0, 12)}…).`);
