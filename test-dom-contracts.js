// Medicus Suite — DOM contract registry + recorded-fixture tests
// Run with: node test-dom-contracts.js
//
// Guards shared/dom-contracts.js (the Horizon-1 DOM-contract registry) and the
// fixtures/medicus/*.html recorded/synthesised snapshots against three things:
//   1. registry schema — every contract has the required fields, in the right
//      shapes, and every `runtime: false` contract documents why.
//   2. every contract's fixture(s) exist and satisfy the contract: the
//      "current" fixture matches `anchor` + `target`; each "legacy" fixture
//      matches `anchor` and is satisfied by its `legacy` fallback tier (with
//      `target` genuinely absent, so the test is exercising the fallback and
//      not accidentally re-matching target).
//   3. probe semantics: anchor present + target/legacy absent → FAIL; anchor
//      absent → NOT_APPLICABLE (never a false alarm) — verified generically
//      against small inline fragments, not tied to any one fixture file.
//
// No new test dependency: fixtures are plain HTML, parsed by a small
// self-contained tag/attribute tokeniser + CSS-subset selector matcher below
// (tag, .class, [attr], [attr="v"], [attr^="v"]/[attr*="v"]/[attr$="v"],
// comma lists, single-level descendant combinators — everything every
// contract's selectors actually use; no pseudo-classes/combinators beyond
// that are needed). Mirrors the house fake-DOM-harness style used by
// test-lab-file-macro.js, just fed from real fixture files instead of
// hand-built element objects.

'use strict';

const fs = require('fs');
const path = require('path');
const DomContracts = require('./shared/dom-contracts.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ============================================================
// Minimal HTML → fake-DOM parser (attributes/classes/tags only — no text
// content is ever extracted, since every contract here is selector-only;
// text-filtering, where the real consumer does it, is out of scope for a
// static fixture probe).
// ============================================================

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function makeNode(tag) {
  return { tag: tag.toLowerCase(), attrs: {}, children: [] };
}

function parseHTML(html) {
  const root = makeNode('#root');
  const stack = [root];
  let current = root;
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
  let m;
  while ((m = tagRe.exec(clean))) {
    const isClose = clean[m.index + 1] === '/';
    const tag = m[1].toLowerCase();
    if (isClose) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      current = stack[stack.length - 1];
      continue;
    }
    const node = makeNode(tag);
    const attrStr = m[2] || '';
    attrRe.lastIndex = 0;
    let am;
    while ((am = attrRe.exec(attrStr))) {
      if (!am[1]) continue;
      const name = am[1].toLowerCase();
      const val = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[2] !== undefined ? am[2] : '';
      node.attrs[name] = val;
    }
    current.children.push(node);
    const selfClose = m[3] === '/' || VOID_TAGS.has(tag);
    if (!selfClose) {
      stack.push(node);
      current = node;
    }
  }
  return root;
}

// ── Selector matching (subset of CSS: tag, .class, [attr], [attr=/^=/*=/$="v"],
// comma lists, single-space descendant combinator) ──────────────────────────

function collectDescendants(node, out) {
  for (const c of node.children) {
    out.push(c);
    collectDescendants(c, out);
  }
}

function matchesCompound(node, compound) {
  const m = compound.match(/^([a-zA-Z][a-zA-Z0-9-]*)?((?:\.[a-zA-Z0-9_-]+|\[[^\]]+\])*)$/);
  if (!m) return false;
  const tag = m[1];
  if (tag && node.tag !== tag.toLowerCase()) return false;
  const partRe = /\.[a-zA-Z0-9_-]+|\[[^\]]+\]/g;
  let pm;
  while ((pm = partRe.exec(m[2] || ''))) {
    const part = pm[0];
    if (part[0] === '.') {
      const cls = part.slice(1);
      const classAttr = node.attrs['class'] || '';
      if (!classAttr.split(/\s+/).includes(cls)) return false;
    } else {
      const am = part.match(/^\[([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:([~^*$|]?=)"([^"]*)")?\]$/);
      if (!am) return false;
      const aname = am[1].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(node.attrs, aname)) return false;
      const op = am[2];
      if (op) {
        const v = node.attrs[aname];
        const want = am[3];
        if (op === '=' && v !== want) return false;
        if (op === '^=' && !v.startsWith(want)) return false;
        if (op === '*=' && !v.includes(want)) return false;
        if (op === '$=' && !v.endsWith(want)) return false;
      }
    }
  }
  return true;
}

function queryOneSelector(root, selector) {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  let contexts = [root];
  for (const part of parts) {
    const next = [];
    const seen = new Set();
    for (const ctx of contexts) {
      const all = [];
      collectDescendants(ctx, all);
      for (const n of all) {
        if (matchesCompound(n, part) && !seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    contexts = next;
  }
  return contexts;
}

// Attach a real querySelectorAll to a parsed root, matching the interface
// shared/dom-contracts.js's probeContract expects (array-like with .length).
function asProbeRoot(root) {
  root.querySelectorAll = (selectorList) => {
    const seen = new Set();
    const out = [];
    String(selectorList)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((sel) => {
        for (const n of queryOneSelector(root, sel)) {
          if (!seen.has(n)) {
            seen.add(n);
            out.push(n);
          }
        }
      });
    return out;
  };
  return root;
}

function loadFixture(name) {
  const p = path.join(__dirname, 'fixtures', 'medicus', name);
  const html = fs.readFileSync(p, 'utf8');
  return asProbeRoot(parseHTML(html));
}

function fixtureExists(name) {
  return fs.existsSync(path.join(__dirname, 'fixtures', 'medicus', name));
}

// ============================================================
// 1. Registry schema validation
// ============================================================
console.log('--- registry schema ---');

const contracts = DomContracts.list();
check(Array.isArray(contracts) && contracts.length > 0, `registry has contracts (${contracts.length})`);

const seenIds = new Set();
for (const c of contracts) {
  check(typeof c.id === 'string' && c.id.length > 0, `${c.id || '(missing id)'}: has a string id`);
  check(!seenIds.has(c.id), `${c.id}: id is unique`);
  seenIds.add(c.id);
  check(typeof c.description === 'string' && c.description.length > 10, `${c.id}: has a description`);
  check(typeof c.feature === 'string' && c.feature.length > 0, `${c.id}: has a feature name`);
  check(typeof c.degradation === 'string' && c.degradation.length > 10, `${c.id}: documents what degrades`);
  check(typeof c.source === 'string' && c.source.length > 0, `${c.id}: cites a source file:lines`);
  check(c.pageMatch === null || c.pageMatch instanceof RegExp, `${c.id}: pageMatch is null or a RegExp`);
  check(typeof c.anchor === 'string' && c.anchor.length > 0, `${c.id}: anchor is a non-empty string`);
  check(
    Array.isArray(c.target) && c.target.length > 0 && c.target.every((s) => typeof s === 'string'),
    `${c.id}: target is a non-empty array of selector strings`
  );
  check(
    Array.isArray(c.legacy) &&
      c.legacy.every((tier) => Array.isArray(tier) && tier.every((s) => typeof s === 'string')),
    `${c.id}: legacy is an array of selector-string tiers`
  );
  check(typeof c.runtime === 'boolean', `${c.id}: runtime is a boolean`);
  if (c.runtime === false) {
    check(
      typeof c.runtimeNote === 'string' && c.runtimeNote.length > 10,
      `${c.id}: runtime:false is documented with a runtimeNote`
    );
  }
  check(c.mirrorOf === null || c.mirrorOf === 'content.js', `${c.id}: mirrorOf is null or 'content.js'`);
}

// get()/selectorsFor() lookups
check(DomContracts.get('oir.checkbox') !== null, "get('oir.checkbox') resolves");
check(DomContracts.get('nonexistent.contract') === null, 'get() returns null for an unknown id');
const sel = DomContracts.selectorsFor('routine-rx.routing-control');
check(
  !!sel && Array.isArray(sel.target) && Array.isArray(sel.legacy),
  'selectorsFor() returns { anchor, target, legacy }'
);
check(DomContracts.selectorsFor('nonexistent.contract') === null, 'selectorsFor() returns null for an unknown id');

// ============================================================
// 2. Fixture coverage — id → { current, legacy: [...] }
// ============================================================
console.log('\n--- fixture coverage ---');

const FIXTURES = {
  'oir.checkbox': { current: 'oir-checkbox-current.html', legacy: ['oir-checkbox-legacy.html'] },
  'queue.chip-host': {
    current: 'queue-chip-host-current.html',
    legacy: ['queue-chip-host-legacy-1.html', 'queue-chip-host-legacy-2.html'],
  },
  'queue.preview-row-link': {
    current: 'queue-preview-row-link-current.html',
    legacy: ['queue-preview-row-link-legacy.html'],
  },
  'queue.chip-marker-classes': { current: 'queue-chip-marker-classes.html', legacy: [] },
  'routine-rx.routing-control': {
    current: 'routine-rx-routing-control-current.html',
    legacy: ['routine-rx-routing-control-legacy.html'],
  },
  'routine-rx.assignee-option': { current: 'routine-rx-assignee-option.html', legacy: [] },
  'routine-rx.action-anchor': { current: 'routine-rx-action-anchor.html', legacy: [] },
  'lab-file.file-button': { current: 'lab-file-file-button.html', legacy: [] },
  'lab-file.normal-option-controls': { current: 'lab-file-normal-option-controls.html', legacy: [] },
  'task-widget.codes-actions-heading': {
    current: 'task-widget-codes-actions-heading-current.html',
    legacy: ['task-widget-codes-actions-heading-legacy.html'],
  },
  'task-widget.card-submit-button': { current: 'task-widget-card-submit-button.html', legacy: [] },
  'task-inline.action-row': { current: 'task-inline-action-row.html', legacy: [] },
  'sentinel.mount-anchor': { current: 'sentinel-mount-anchor.html', legacy: [] },
  'api-client.patient-uuid-dom-fallback': {
    current: 'api-client-patient-uuid-dom-fallback-current.html',
    legacy: ['api-client-patient-uuid-dom-fallback-legacy.html'],
  },
};

// Every contract in the registry must have a fixture-map entry, and vice
// versa — the map and the registry cannot silently drift apart.
for (const c of contracts) {
  check(!!FIXTURES[c.id], `${c.id}: has a fixture-coverage entry`);
}
for (const id of Object.keys(FIXTURES)) {
  check(!!DomContracts.get(id), `fixture entry ${id}: corresponds to a registered contract`);
}

// ============================================================
// 3. Per-contract fixture checks
// ============================================================
console.log('\n--- fixture probes ---');

for (const c of contracts) {
  const map = FIXTURES[c.id];
  if (!map) continue; // already flagged above

  // "current" fixture: must exist, and must satisfy anchor + target directly
  // (not merely via a legacy fallback) — status ok, targetCount >= 1.
  check(fixtureExists(map.current), `${c.id}: current fixture file exists (${map.current})`);
  if (fixtureExists(map.current)) {
    const root = loadFixture(map.current);
    const result = DomContracts.probeContract(c, root);
    check(result.anchorCount >= 1, `${c.id}: current fixture satisfies anchor (${c.anchor})`);
    check(result.targetCount >= 1, `${c.id}: current fixture satisfies target directly`);
    check(result.status === DomContracts.STATUS.OK, `${c.id}: current fixture probes OK`);
  }

  // Each "legacy" fixture: anchor present, target genuinely ABSENT, but the
  // matching legacy tier satisfies the probe (status ok via fallback).
  map.legacy.forEach((file, tierIdx) => {
    check(fixtureExists(file), `${c.id}: legacy fixture[${tierIdx}] file exists (${file})`);
    if (!fixtureExists(file)) return;
    const root = loadFixture(file);
    const result = DomContracts.probeContract(c, root);
    check(result.anchorCount >= 1, `${c.id}: legacy fixture[${tierIdx}] satisfies anchor`);
    check(
      result.targetCount === 0,
      `${c.id}: legacy fixture[${tierIdx}] genuinely lacks target (exercises the fallback)`
    );
    check(
      Array.isArray(result.legacyCounts) && result.legacyCounts[tierIdx] > 0,
      `${c.id}: legacy fixture[${tierIdx}] is satisfied by legacy tier[${tierIdx}] (${JSON.stringify(c.legacy[tierIdx])})`
    );
    check(
      result.status === DomContracts.STATUS.OK,
      `${c.id}: legacy fixture[${tierIdx}] still probes OK (current-vs-legacy fallback works)`
    );
  });
}

// ============================================================
// 4. Probe semantics — generic, not tied to any one fixture file
// ============================================================
console.log('\n--- probe semantics ---');

// Build a throwaway contract + fragments in-memory to exercise the FAIL and
// NOT_APPLICABLE branches independently of any real contract's fixtures.
const semanticsContract = {
  id: 'test.semantics-probe',
  anchor: '.probe-anchor',
  target: ['.probe-target'],
  legacy: [['.probe-legacy']],
};

// anchor present, target AND legacy both absent → FAIL
{
  const root = asProbeRoot(parseHTML('<div class="probe-anchor"><span>nothing else</span></div>'));
  const result = DomContracts.probeContract(semanticsContract, root);
  check(result.status === DomContracts.STATUS.FAIL, 'anchor present + target/legacy absent -> FAIL');
  check(result.anchorCount === 1 && result.targetCount === 0, 'FAIL result reports anchorCount=1, targetCount=0');
}

// anchor present, target absent, but legacy satisfied → OK (not FAIL)
{
  const root = asProbeRoot(parseHTML('<div class="probe-anchor"><span class="probe-legacy">fallback</span></div>'));
  const result = DomContracts.probeContract(semanticsContract, root);
  check(result.status === DomContracts.STATUS.OK, 'anchor present + legacy satisfied -> OK (fallback covers it)');
}

// anchor absent entirely → NOT_APPLICABLE, regardless of target presence
{
  const root = asProbeRoot(parseHTML('<div class="unrelated"><span class="probe-target">stray match</span></div>'));
  const result = DomContracts.probeContract(semanticsContract, root);
  check(result.status === DomContracts.STATUS.NOT_APPLICABLE, 'anchor absent -> NOT_APPLICABLE, never a false alarm');
  check(result.anchorCount === 0, 'NOT_APPLICABLE result reports anchorCount=0');
}

// anchor present, target present → OK
{
  const root = asProbeRoot(parseHTML('<div class="probe-anchor"><span class="probe-target">present</span></div>'));
  const result = DomContracts.probeContract(semanticsContract, root);
  check(result.status === DomContracts.STATUS.OK, 'anchor present + target present -> OK');
}

// probeContract never throws on a garbage contract/root
{
  check(
    DomContracts.probeContract(null, null).status === DomContracts.STATUS.NOT_APPLICABLE,
    'probeContract(null, null) fails closed to NOT_APPLICABLE, never throws'
  );
  check(
    DomContracts.probeContract(semanticsContract, {}).status === DomContracts.STATUS.NOT_APPLICABLE,
    'probeContract() against a root with no querySelectorAll fails closed, never throws'
  );
}

// probeAll() covers every registered contract without throwing
{
  const allResults = DomContracts.probeAll(asProbeRoot(parseHTML('<div></div>')));
  check(allResults.length === contracts.length, 'probeAll() returns one result per registered contract');
  // Only assert NOT_APPLICABLE for runtime:true contracts — their anchors were
  // specifically chosen to be meaningful/narrow enough to canary live. Several
  // runtime:false contracts deliberately reuse generic role-family anchors
  // (documented in their runtimeNote as a false-positive risk) that a bare
  // <div></div> can legitimately satisfy — that is the documented limitation,
  // not a bug in the probe.
  const runtimeIds = new Set(contracts.filter((c) => c.runtime).map((c) => c.id));
  const runtimeResults = allResults.filter((r) => runtimeIds.has(r.id));
  check(runtimeResults.length > 0, 'at least one runtime:true contract exists to exercise this check');
  check(
    runtimeResults.every((r) => r.status === DomContracts.STATUS.NOT_APPLICABLE),
    'probeAll() against an empty page reports every runtime:true contract NOT_APPLICABLE (no false alarms)'
  );
}

// ============================================================
if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
