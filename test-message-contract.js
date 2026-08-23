// Medicus Suite — cross-context message inventory (architecture plan Phase 0.6)
// Run with: node test-message-contract.js
//
// There is no central message-contract module. This test enumerates the
// string literals used as `action:` / `type:` on chrome.runtime.sendMessage
// (and tabs.sendMessage) and on onMessage handlers, then asserts:
//   1. every handled action/type is sent somewhere (or is on HANDLED_ONLY)
//   2. every sent action/type is handled somewhere (or is on SENT_ONLY)
//   3. every product file with onMessage.addListener contains a sender-id
//      gate, or is on NO_SENDER_GATE with a reason
//
// The lists below are the recorded exceptions, not a default. A new
// one-way or ungated listener needs a reason in the same PR.

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
const SKIP_DIR = new Set(['node_modules', 'vendor', '.git', 'docs']);

function listJs(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
      out.push(...listJs(full));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !/^test-/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relPosix(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

const PRODUCT_JS = [
  path.join(ROOT, 'service-worker.js'),
  ...listJs(path.join(ROOT, 'content-scripts')),
  ...listJs(path.join(ROOT, 'side-panel')),
  ...listJs(path.join(ROOT, 'pop-out')),
  ...listJs(path.join(ROOT, 'shared')),
  ...listJs(path.join(ROOT, 'options')),
  ...listJs(path.join(ROOT, 'engine')),
  ...listJs(path.join(ROOT, 'sentinel-options')),
];

const SENT_RE =
  /(?:sendMessage|swMessage|broadcastToSidePanel)\(\s*(?:[^,{]*?,\s*)?\{\s*(?:action|type)\s*:\s*['"]([a-zA-Z0-9:_-]+)['"]/g;
const HANDLED_EQ_RE = /msg\??\.(?:action|type)\s*(?:===|!==)\s*['"]([a-zA-Z0-9:_-]+)['"]/g;
const MSG_SWITCH_RE = /switch\s*\(\s*msg\??\.(?:action|type)\s*\)\s*\{/g;

const JS_TYPE_NAMES = new Set(['string', 'number', 'object', 'boolean', 'undefined', 'function']);

const sent = new Map(); // name → [files]
const handled = new Map();

function add(map, name, rel) {
  if (!map.has(name)) map.set(name, []);
  map.get(name).push(rel);
}

for (const abs of PRODUCT_JS) {
  const src = fs.readFileSync(abs, 'utf8');
  const rel = relPosix(abs);
  let m;
  SENT_RE.lastIndex = 0;
  while ((m = SENT_RE.exec(src)) !== null) add(sent, m[1], rel);
  HANDLED_EQ_RE.lastIndex = 0;
  while ((m = HANDLED_EQ_RE.exec(src)) !== null) {
    if (!JS_TYPE_NAMES.has(m[1])) add(handled, m[1], rel);
  }
  // case labels only inside `switch (msg.action)` / `switch (msg.type)`
  MSG_SWITCH_RE.lastIndex = 0;
  while ((m = MSG_SWITCH_RE.exec(src)) !== null) {
    let depth = 0;
    const start = src.indexOf('{', m.index);
    if (start < 0) continue;
    let end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const block = end === -1 ? '' : src.slice(start, end);
    for (const c of block.matchAll(/case\s+['"]([a-zA-Z0-9:_-]+)['"]/g)) add(handled, c[1], rel);
  }
}

// Broadcasts that SW / CS fire and the panel listens for (`type:`).
// Also catch `broadcastToSidePanel({ type: '...' })` which is not sendMessage.
const BROADCAST_RE = /(?:broadcastToSidePanel|sendMessage)\(\s*\{\s*type\s*:\s*['"]([a-zA-Z0-9:_-]+)['"]/g;
for (const abs of PRODUCT_JS) {
  const src = fs.readFileSync(abs, 'utf8');
  const rel = relPosix(abs);
  let m;
  BROADCAST_RE.lastIndex = 0;
  while ((m = BROADCAST_RE.exec(src)) !== null) add(sent, m[1], rel);
}

check(sent.size >= 8, `found ${sent.size} sent action/type literals`);
check(handled.size >= 5, `found ${handled.size} handled action/type literals`);

// Phase 5.1 — lock-step with shared/messages.js ACTIONS. Handlers keep raw
// string literals so this inventory still sees them; ACTIONS must name every
// inventoried runtime action (scanner noise `basic` is not a runtime message).
const SuiteMessages = require('./shared/messages.js');
check(typeof SuiteMessages.gatedListener === 'function', 'SuiteMessages.gatedListener is exported');
check(SuiteMessages.ACTIONS && typeof SuiteMessages.ACTIONS === 'object', 'SuiteMessages.ACTIONS is exported');

const actionValues = new Set(Object.values(SuiteMessages.ACTIONS));
const inventoryNames = new Set([...sent.keys(), ...handled.keys()].filter((k) => k !== 'basic'));
const missingInActions = [...inventoryNames].filter((k) => !actionValues.has(k));
check(
  missingInActions.length === 0,
  missingInActions.length === 0
    ? 'every inventoried action/type is in SuiteMessages.ACTIONS'
    : `inventoried names missing from ACTIONS: ${missingInActions.join(', ')}`
);
const unusedActions = [...actionValues].filter((k) => !inventoryNames.has(k));
check(
  unusedActions.length === 0,
  unusedActions.length === 0
    ? 'every ACTIONS value appears as sent or handled'
    : `ACTIONS values not in inventory (stale?): ${unusedActions.join(', ')}`
);

{
  const prevChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { id: 'ext-id' } };
  const calls = [];
  const wrapped = SuiteMessages.gatedListener((msg) => {
    calls.push(msg);
  });
  wrapped({ type: 'x' }, { id: 'other' });
  check(calls.length === 0, 'gatedListener drops a foreign sender');
  wrapped({ type: 'x' }, { id: 'ext-id' });
  check(calls.length === 1, 'gatedListener accepts this extension');
  wrapped({ type: 'x' }, null);
  check(calls.length === 1, 'gatedListener drops a missing sender');
  if (prevChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = prevChrome;
}

// Recorded exceptions. A new entry is a deliberate decision.
const SENT_ONLY = {
  'popout:closed': 'broadcast after window close; listeners treat it as informational',
  basic: 'chrome.notifications.create type, not a runtime message — scanner noise',
};

const HANDLED_ONLY = {
  openOptionsPage:
    'legacy SW switch case; live callers use chrome.runtime.openOptionsPage() directly. Kept so an older content-script build still works.',
};

const unhandledSends = [...sent.keys()].filter((k) => !handled.has(k) && !SENT_ONLY[k]);
const unsentHandles = [...handled.keys()].filter((k) => !sent.has(k) && !HANDLED_ONLY[k]);

check(
  unhandledSends.length === 0,
  unhandledSends.length === 0
    ? 'every sent action/type is handled or SENT_ONLY'
    : `sent but never handled (add a handler or SENT_ONLY reason): ${unhandledSends.join(', ')}`
);
check(
  unsentHandles.length === 0,
  unsentHandles.length === 0
    ? 'every handled action/type is sent or HANDLED_ONLY'
    : `handled but never sent (add a sender or HANDLED_ONLY reason): ${unsentHandles.join(', ')}`
);

// Stale exception names.
for (const k of Object.keys(SENT_ONLY)) {
  if (k === 'basic') continue; // scanner noise, may or may not appear
  check(sent.has(k) || handled.has(k), `SENT_ONLY "${k}" still appears in product source`);
}

// ── Sender-gate inventory ────────────────────────────────────────────────────

const NO_SENDER_GATE = {
  'side-panel/modules/record/record.js':
    'listens for sentinel:snapshot-updated only; not a privileged action router',
};

const GATE_RE =
  /sender\.id\s*!==\s*chrome\.runtime\.id|sender\.id\s*===\s*chrome\.runtime\.id|SuiteMessages\.gatedListener/;

const listenerFiles = [];
for (const abs of PRODUCT_JS) {
  const src = fs.readFileSync(abs, 'utf8');
  if (!src.includes('onMessage.addListener')) continue;
  listenerFiles.push({ rel: relPosix(abs), src });
}

check(listenerFiles.length >= 5, `found ${listenerFiles.length} onMessage.addListener files`);

for (const { rel, src } of listenerFiles) {
  const gated = GATE_RE.test(src);
  if (gated) {
    check(true, `${rel} has a sender-id gate`);
  } else if (NO_SENDER_GATE[rel]) {
    check(true, `${rel} ungated — ${NO_SENDER_GATE[rel]}`);
  } else {
    check(false, `${rel} has onMessage.addListener but no sender-id gate and no NO_SENDER_GATE reason`);
  }
}

const staleGates = Object.keys(NO_SENDER_GATE).filter((rel) => !listenerFiles.some((f) => f.rel === rel));
check(
  staleGates.length === 0,
  staleGates.length === 0
    ? 'no stale NO_SENDER_GATE entries'
    : `stale NO_SENDER_GATE (file no longer listens): ${staleGates.join(', ')}`
);

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
