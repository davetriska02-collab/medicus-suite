// Medicus Suite — Live-grid injection smoke harness (Phase 0 item 0.1,
// docs/plans/TRIAGE-LENS-2026-07-02.md)
// Run with: node test-queue-injection-smoke.js
//
// The chip-injection layer (content-scripts/triage-lens/content.js) is the
// most-regressed surface in the suite (v3.67 append regression, v3.69 row-id
// no-op) and until now was guarded only by source-greps (Layer 3 of
// test-result-triage-queue.js) and static HTML fixtures
// (fixtures/medicus/queue-*.html) — nothing actually DROVE the injector
// against a fake grid and watched what landed in the DOM. This file does
// that: it vm-extracts the real injection functions from content.js (same
// pattern as test-result-triage-queue.js/test-monitoring-chip.js extracting
// selectResultChips/selectMonitoringDue) and runs them against a small,
// purpose-built fake AG-Grid DOM (same "fake DOM, no jsdom" approach as
// test-lab-file-macro.js — this repo's only runtime devDeps are eslint /
// prettier, see package.json).
//
// EXTRACTED VERBATIM from content.js (the actual injection mechanics under
// test): findQueuePreviewRow, queueChipHost, decorateOneRow,
// decorateQueueRows, queueScope, injectResultChip, reinjectCachedResultChips,
// injectQueueMonitoringChip, reinjectCachedMonitoringChips, plus their small
// pure dependencies (renderChipHtml/escapeHtml, selectResultChips,
// renderSystemChipHtmlMemo, TH/TH_DEFAULTS, parseDate/daysAgo/MONTHS/NOW,
// QUEUE_DECORATED_KEY).
//
// STUBBED (deliberately, not injection mechanics — already covered by other
// test files): getSystemChip/matchRules (chip *content*/enable-state is
// exercised via selectResultChips in test-result-triage-queue.js Layer 1 and
// selectMonitoringDue in test-monitoring-chip.js Layer 2), showActionMenu
// (only reachable via a click we never simulate), log (console noise).
//
// NOT COVERED HERE (documented, not faked):
//   - computeQueueRowResult / computeQueueRowMonitoring / the fetch
//     schedulers (scheduleQueueResultTriage / scheduleQueueMonitoring) —
//     network + engine evaluation, out of scope for a DOM-injection
//     harness; that pipeline's wiring is source-verified in
//     test-result-triage-queue.js Layers 3/3b/3c.
//   - refreshQueueChips itself — it also owns the MutationObserver
//     lifecycle (disconnect/observe/setupQueueObserver/removeQueueLegend),
//     which needs a real MutationObserver to exercise meaningfully. Instead
//     this harness replicates its DOM-relevant SEQUENCE directly (wipe chip
//     nodes -> decorateQueueRows -> reinjectCachedResultChips ->
//     reinjectCachedMonitoringChips, the same three calls refreshQueueChips
//     makes) so the actual regression surface — "does re-inject restore the
//     right chip on the right row after Vue wipes the DOM" — is exercised
//     behaviourally, while the observer-rearming plumbing stays covered by
//     the existing source-grep in test-result-triage-queue.js Layer 3.
//   - getSystemChip/matchRules' real CONFIG-driven behaviour (custom
//     labels, disabled chips) — stubbed here on purpose; see above.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
// Fake DOM + CSS-selector engine
// ============================================================
// Purpose-built for the exact selector shapes the extracted functions use:
// tag, .class (repeatable/AND), [attr], [attr="value"], :not(<simple>), and
// comma-separated groups (OR). Nothing more general is needed.

class El {
  constructor(tag, attrs) {
    this.tag = String(tag || 'div').toLowerCase();
    this.attrs = {};
    this.classes = [];
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this._text = '';
    this._innerHTML = null;
    this._listeners = {};
    if (attrs) for (const k of Object.keys(attrs)) this.setAttribute(k, attrs[k]);
  }
  setAttribute(name, value) {
    if (name === 'class') this.classes = String(value).split(/\s+/).filter(Boolean);
    else this.attrs[name] = String(value);
  }
  getAttribute(name) {
    if (name === 'class') return this.classes.join(' ');
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get classList() {
    const self = this;
    return {
      contains: (c) => self.classes.includes(c),
      // Real DOM classList.add/remove are variadic (content.js's clearQueueRowTint
      // calls classList.remove(ROW_TINT_RED, ROW_TINT_AMBER) with two args) — match
      // that here, not just the single-class shape earlier callers happened to use.
      add: (...cs) => {
        for (const c of cs) if (!self.classes.includes(c)) self.classes.push(c);
      },
      remove: (...cs) => {
        self.classes = self.classes.filter((x) => !cs.includes(x));
      },
    };
  }
  set className(v) {
    this.classes = String(v).split(/\s+/).filter(Boolean);
  }
  get className() {
    return this.classes.join(' ');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
  }
  get innerHTML() {
    return this._innerHTML == null ? '' : this._innerHTML;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  insertBefore(newNode, refNode) {
    newNode.parent = this;
    if (refNode == null) {
      this.children.push(newNode);
      return newNode;
    }
    const idx = this.children.indexOf(refNode);
    if (idx === -1) {
      this.children.push(newNode);
      return newNode;
    }
    this.children.splice(idx, 0, newNode);
    return newNode;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parent = null;
    return child;
  }
  remove() {
    if (this.parent) this.parent.removeChild(this);
  }
  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }
  get firstElementChild() {
    return this.firstChild;
  }
  get nextElementSibling() {
    if (!this.parent) return null;
    const idx = this.parent.children.indexOf(this);
    return idx >= 0 && idx + 1 < this.parent.children.length ? this.parent.children[idx + 1] : null;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  dispatchEvent() {}
  querySelector(sel) {
    return findFirst(this, sel);
  }
  querySelectorAll(sel) {
    return findAll(this, sel);
  }
}

function elText(tag, attrs, text) {
  const e = new El(tag, attrs);
  e.textContent = text;
  return e;
}

function collectDescendants(el, out) {
  for (const c of el.children) {
    out.push(c);
    collectDescendants(c, out);
  }
  return out;
}

function matchesCompound(el, token) {
  token = token.trim();
  if (!token) return false;
  let rest = token;
  const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagMatch) {
    if (el.tag !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  const pieceRe = /\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|:not\(([^()]*)\)/g;
  let pm;
  while ((pm = pieceRe.exec(rest))) {
    const piece = pm[0];
    if (piece[0] === '.') {
      if (!el.classes.includes(piece.slice(1))) return false;
    } else if (piece[0] === '[') {
      const am = piece.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      const actual = el.getAttribute(am[1]);
      if (actual === null) return false;
      if (am[2] !== undefined && actual !== am[2]) return false;
    } else if (piece.startsWith(':not(')) {
      if (matchesCompound(el, pm[1])) return false;
    }
  }
  return true;
}

function matchesSelector(el, selector) {
  return selector.split(',').some((tok) => matchesCompound(el, tok));
}

function findFirst(root, sel) {
  const list = collectDescendants(root, []);
  for (const node of list) if (matchesSelector(node, sel)) return node;
  return null;
}
function findAll(root, sel) {
  return collectDescendants(root, []).filter((node) => matchesSelector(node, sel));
}

function makeDocument(rootEl) {
  return {
    __root: rootEl,
    createElement(tag) {
      return new El(tag);
    },
    querySelector(sel) {
      return findFirst(rootEl, sel);
    },
    querySelectorAll(sel) {
      return findAll(rootEl, sel);
    },
    contains(node) {
      if (node === rootEl) return true;
      let p = node && node.parent;
      while (p) {
        if (p === rootEl) return true;
        p = p.parent;
      }
      return false;
    },
  };
}

// Build a preview/detail row pair matching
// fixtures/medicus/queue-chip-host-current.html (master row-id="<UUID>",
// linked detail row row-id="detail_<UUID>", inner .h-full.w-full > p.q-pa-xs).
function buildPreviewRowPair({ rowIndex, rowId, dob, priority = 'Routine', created = '01 Jan 2020' }) {
  const master = new El('div', { class: 'ag-row', 'row-id': rowId, 'row-index': String(rowIndex) });
  const nameCell = new El('div', { 'col-id': 'patientName', class: 'ag-cell' });
  nameCell.appendChild(elText('span', { class: 'q-name' }, 'Placeholder, Patient'));
  master.appendChild(nameCell);
  master.appendChild(elText('div', { 'col-id': 'dateOfBirth', class: 'ag-cell' }, dob));
  master.appendChild(elText('div', { 'col-id': 'priorityDisplay', class: 'ag-cell' }, priority));
  master.appendChild(elText('div', { 'col-id': 'createdAt', class: 'ag-cell' }, created));

  const detail = new El('div', { class: 'ag-full-width-row', 'row-id': 'detail_' + rowId });
  const wrap = new El('div', { class: 'h-full w-full' });
  wrap.appendChild(elText('p', { class: 'q-pa-xs' }, 'Request: placeholder request text'));
  detail.appendChild(wrap);

  return { master, nameCell, detail, wrap };
}

// Flat single-line row (no preview/detail row at all — CLAUDE.md's
// documented fallback host: [col-id="patientName"]).
function buildFlatRow({ rowIndex, rowId, dob }) {
  const master = new El('div', { class: 'ag-row', 'row-id': rowId, 'row-index': String(rowIndex) });
  const nameCell = new El('div', { 'col-id': 'patientName', class: 'ag-cell' });
  nameCell.appendChild(elText('span', { class: 'q-name' }, 'Doe, Jane'));
  master.appendChild(nameCell);
  master.appendChild(elText('div', { 'col-id': 'dateOfBirth', class: 'ag-cell' }, dob));
  return { master, nameCell };
}

// ============================================================
// vm-extract the real injection functions from content.js
// ============================================================
const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

function extract(re, label) {
  const m = src.match(re);
  check(!!m, `${label} extracted from content.js`);
  return m ? m[0] : '';
}

console.log('Extraction: pulling injection functions + their small pure deps out of content.js');
const parts = [
  extract(/const _HTML_ESC = \{[\s\S]*?\};/, '_HTML_ESC'),
  extract(/const escapeHtml = \(s\)[\s\S]*?;/, 'escapeHtml'),
  extract(/const renderChipHtml = \(chip\) => \{[\s\S]*?\n {2}\};/, 'renderChipHtml'),
  extract(/const MONTHS = \{[\s\S]*?\};/, 'MONTHS'),
  extract(/const NOW = \(\)[\s\S]*?;/, 'NOW'),
  extract(/const parseDate = \(s\) => \{[\s\S]*?\n {2}\};/, 'parseDate'),
  extract(/const daysAgo = \(d\) => \{[\s\S]*?\n {2}\};/, 'daysAgo'),
  extract(/const TH_DEFAULTS = \{[\s\S]*?\};/, 'TH_DEFAULTS'),
  extract(/const TH = \(k\) => \{[\s\S]*?\n {2}\};/, 'TH'),
  extract(/const PREF = \(k, dflt\) => \{[\s\S]*?\n {2}\};/, 'PREF'),
  extract(/const QUEUE_DECORATED_KEY = .*;/, 'QUEUE_DECORATED_KEY'),
  extract(/function selectResultChips\(sev\) \{[\s\S]*?\n {2}\}/, 'selectResultChips'),
  extract(/const renderSystemChipHtmlMemo = \(id, vars\) => \{[\s\S]*?\n {2}\};/, 'renderSystemChipHtmlMemo'),
  extract(/const findQueuePreviewRow = \(row\) => \{[\s\S]*?\n {2}\};/, 'findQueuePreviewRow'),
  extract(/const queueChipHost = \(row, marker\) => \{[\s\S]*?\n {2}\};/, 'queueChipHost'),
  extract(/const decorateOneRow = \(row\) => \{[\s\S]*?\n {2}\};/, 'decorateOneRow'),
  extract(/const decorateQueueRows = \(\) => \{[\s\S]*?\n {2}\};/, 'decorateQueueRows'),
  extract(/const queueScope = \(\)[\s\S]*?;/, 'queueScope'),
  // Item 1.1 leg D (TRIAGE-LENS-2026-07-02.md) — the "couldn't check" grey
  // error chip. RESULT_ERROR_CHIP_HTML is a free variable inside
  // injectResultChip, so it must be extracted alongside it.
  extract(/const RESULT_ERROR_CHIP_HTML =[\s\S]*?;/, 'RESULT_ERROR_CHIP_HTML'),
  extract(/const injectResultChip = \(rowIndex, sev, isError\) => \{[\s\S]*?\n {2}\};/, 'injectResultChip'),
  extract(/const reinjectCachedResultChips = \(\) => \{[\s\S]*?\n {2}\};/, 'reinjectCachedResultChips'),
  extract(/const injectQueueMonitoringChip = \(rowIndex, result\) => \{[\s\S]*?\n {2}\};/, 'injectQueueMonitoringChip'),
  extract(/const reinjectCachedMonitoringChips = \(\) => \{[\s\S]*?\n {2}\};/, 'reinjectCachedMonitoringChips'),
  // Item 1.3 — severity row tint (docs/plans/TRIAGE-LENS-2026-07-02.md).
  extract(/const ROW_TINT_RED = .*;/, 'ROW_TINT_RED'),
  extract(/const ROW_TINT_AMBER = .*;/, 'ROW_TINT_AMBER'),
  extract(/const clearQueueRowTint = \(\) => \{[\s\S]*?\n {2}\};/, 'clearQueueRowTint'),
  extract(/const reapplyQueueRowTint = \(\) => \{[\s\S]*?\n {2}\};/, 'reapplyQueueRowTint'),
];

const EXPOSE = [
  'renderChipHtml',
  'selectResultChips',
  'renderSystemChipHtmlMemo',
  'findQueuePreviewRow',
  'queueChipHost',
  'decorateOneRow',
  'decorateQueueRows',
  'queueScope',
  'injectResultChip',
  'reinjectCachedResultChips',
  'injectQueueMonitoringChip',
  'reinjectCachedMonitoringChips',
  'clearQueueRowTint',
  'reapplyQueueRowTint',
];

let sandbox = null;
if (!parts.some((p) => !p)) {
  const combinedSrc = parts.join('\n\n') + '\n\n' + EXPOSE.map((n) => `this.${n} = ${n};`).join('\n');

  // Externally-provided globals: real content.js reads these off `window`/
  // `CONFIG`/module-level `let`s. We pre-set them as plain mutable
  // properties on the sandbox (NOT re-declared inside combinedSrc), so the
  // extracted functions' free-variable lookups resolve to whatever this
  // test currently has them pointing at, and Node can mutate/reset them
  // between scenarios by reference.
  sandbox = {
    console,
    CONFIG: {},
    log: () => {},
    showActionMenu: () => {},
    // matchRules is chip-CONTENT logic (text-pattern rule matching), not
    // injection mechanics — stubbed to "no rule chips" so decorateOneRow's
    // chip set is deterministic and driven only by the age/priority/task-age
    // signals this harness controls directly.
    matchRules: () => [],
    // getSystemChip is likewise chip-CONTENT logic (label templating +
    // enabled/disabled), already covered by selectResultChips/
    // selectMonitoringDue tests elsewhere. Stub carries {id, vars} through
    // into the rendered text so injection-mechanics assertions can still
    // tell WHICH chip landed where.
    getSystemChip: (id, vars) => ({
      kind: 'info',
      text: id + (vars ? ' ' + JSON.stringify(vars) : ''),
      ruleId: 'system:' + id,
      hasActions: false,
    }),
    _chipHtmlMemo: new Map(),
    _durableRowMap: new Map(),
    _queueResultCache: new Map(),
    _queueMonCache: new Map(),
    _RESULT_CACHE_TTL: 5 * 60 * 1000,
    // Item 1.1 leg D — error cache entries expire much sooner than a real
    // result so a failed check retries soon (see content.js's own constant).
    _RESULT_ERROR_TTL: 60 * 1000,
    _MON_CACHE_TTL: 5 * 60 * 1000,
    queueObservedContainer: null,
    document: null,
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(combinedSrc, sandbox, { filename: 'content-extract.js' });
    check(typeof sandbox.injectResultChip === 'function', 'injectResultChip compiled and callable');
    check(typeof sandbox.injectQueueMonitoringChip === 'function', 'injectQueueMonitoringChip compiled and callable');
    check(typeof sandbox.decorateOneRow === 'function', 'decorateOneRow compiled and callable');
    check(typeof sandbox.reinjectCachedResultChips === 'function', 'reinjectCachedResultChips compiled and callable');
    check(
      typeof sandbox.reinjectCachedMonitoringChips === 'function',
      'reinjectCachedMonitoringChips compiled and callable'
    );
    check(typeof sandbox.clearQueueRowTint === 'function', 'clearQueueRowTint compiled and callable');
    check(typeof sandbox.reapplyQueueRowTint === 'function', 'reapplyQueueRowTint compiled and callable');
  } catch (e) {
    check(false, `combined extraction compiled without throwing (${e.message})`);
    sandbox = null;
  }
}

const redSev = {
  level: 'red',
  urgentCount: 1,
  abnormalCount: 1,
  top: { name: 'Potassium', value: '6.8', unit: 'mmol/L' },
  misprioritised: false,
  unmatched: false,
};

const amberSev = {
  level: 'amber',
  urgentCount: 0,
  abnormalCount: 1,
  top: { name: 'Sodium', value: '130', unit: 'mmol/L' },
  misprioritised: false,
  unmatched: false,
};

const noneSev = {
  level: 'none',
  urgentCount: 0,
  abnormalCount: 0,
  top: null,
  misprioritised: false,
  unmatched: false,
};

function freshCaches() {
  sandbox._chipHtmlMemo = new Map();
  sandbox._durableRowMap = new Map();
  sandbox._queueResultCache = new Map();
  sandbox._queueMonCache = new Map();
  sandbox.CONFIG = {}; // PREF('queueRowTint', true) -> true by default (no CONFIG.prefs)
}

if (sandbox) {
  // ============================================================
  // Layer 1 — host selection + PREPEND, preview-row layout
  // ============================================================
  console.log('\nLayer 1: host selection + PREPEND (preview-row layout, fixtures/queue-chip-host-current.html shape)');

  {
    freshCaches();
    const rowId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const { master, detail, wrap } = buildPreviewRowPair({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', { class: 'ag-center-cols-container' });
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox.injectResultChip(0, redSev);
    check(
      wrap.children.length === 2,
      `injectResultChip: chip hosted in the preview row (2 children, got ${wrap.children.length})`
    );
    check(
      wrap.firstChild && wrap.firstChild.classes.includes('ch-q-result'),
      'injectResultChip: PREPENDED — chip is firstChild of the preview-row host, not appended after the request text'
    );
    check(
      !wrap.firstChild.classes.includes('ch-q-result-inline'),
      'injectResultChip: preview-row host gets the non-inline class (no width cap needed — roomy host)'
    );

    sandbox.injectQueueMonitoringChip(0, { level: 'red', count: 2 });
    check(
      wrap.firstChild && wrap.firstChild.classes.includes('ch-q-mon'),
      'injectQueueMonitoringChip: PREPENDED — mon chip is firstChild (ahead of the earlier result chip and the request text)'
    );
    check(
      wrap.children.length === 3,
      `injectQueueMonitoringChip: chip added alongside the result chip (3 children, got ${wrap.children.length})`
    );
  }

  // ============================================================
  // Layer 2 — decorateOneRow (age/decoration family) host + PREPEND
  // ============================================================
  console.log('\nLayer 2: decorateOneRow (age/decoration, DOM-driven) host + PREPEND');

  {
    freshCaches();
    const rowId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    // dob triggers the child-age chip (age 15 < TH('childAge')=16)
    const { master, detail, wrap } = buildPreviewRowPair({ rowIndex: 0, rowId, dob: '01 Jan 2011 (15y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox.decorateOneRow(master);
    check(
      wrap.children.length === 2,
      `decorateOneRow: age chip strip hosted in the preview row (2 children, got ${wrap.children.length})`
    );
    check(
      wrap.firstChild && wrap.firstChild.classes.includes('ch-queue-chips'),
      'decorateOneRow: PREPENDED — .ch-queue-chips strip is firstChild ahead of the request text'
    );
    check(master.dataset.chQDec === '1', 'decorateOneRow: marks the row decorated (chQDec=1)');
  }

  // ============================================================
  // Layer 3 — de-dupe: calling the same injector twice must not duplicate
  // ============================================================
  console.log('\nLayer 3: de-dupe — re-injection is idempotent (CLAUDE.md rule #6)');

  {
    freshCaches();
    const rowId = 'cccccccc-dddd-4eee-8fff-000000000000';
    const { master, detail, wrap } = buildPreviewRowPair({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox.injectResultChip(0, redSev);
    sandbox.injectResultChip(0, redSev); // second call — must be a no-op
    check(
      wrap.querySelectorAll('.ch-q-result').length === 1,
      `injectResultChip: calling twice does not duplicate (1 .ch-q-result span, got ${wrap.querySelectorAll('.ch-q-result').length})`
    );

    sandbox.injectQueueMonitoringChip(0, { level: 'amber', count: 1 });
    sandbox.injectQueueMonitoringChip(0, { level: 'amber', count: 1 });
    check(
      wrap.querySelectorAll('.ch-q-mon').length === 1,
      `injectQueueMonitoringChip: calling twice does not duplicate (1 .ch-q-mon span, got ${wrap.querySelectorAll('.ch-q-mon').length})`
    );

    // decorateOneRow's de-dupe is via the dataset flag, not the marker check
    // alone — calling it again on the SAME (still-flagged) row must no-op.
    sandbox.decorateOneRow(master);
    sandbox.decorateOneRow(master);
    check(
      wrap.querySelectorAll('.ch-queue-chips').length === 1,
      `decorateOneRow: calling twice on an already-decorated row does not duplicate (1 .ch-queue-chips strip, got ${wrap.querySelectorAll('.ch-queue-chips').length})`
    );
  }

  // ============================================================
  // Layer 4 — SPA churn: Vue wipes the injected nodes, re-inject path
  // restores them on the RIGHT row from the durable map + caches
  // ============================================================
  console.log('\nLayer 4: SPA churn — wipe all chip nodes, drive the re-inject path, chips come back on the right row');

  {
    freshCaches();
    const rowIdA = 'dddddddd-eeee-4fff-8000-111111111111';
    const rowIdB = 'eeeeeeee-ffff-4000-8111-222222222222';
    const rowA = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdA, dob: '01 Jan 1980 (46y)' });
    const rowB = buildPreviewRowPair({ rowIndex: 1, rowId: rowIdB, dob: '01 Jan 1990 (36y)' });
    const gridRoot = new El('div', {});
    [rowA, rowB].forEach(({ master, detail }) => {
      gridRoot.appendChild(master);
      gridRoot.appendChild(detail);
    });
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    // Populate as the bridge task-list event would: durable map + caches,
    // then inject once (normal first paint).
    sandbox._durableRowMap.set(0, rowIdA);
    sandbox._durableRowMap.set(1, rowIdB);
    const sevA = redSev;
    const sevB = { ...redSev, top: { name: 'Sodium', value: '121', unit: 'mmol/L' } };
    sandbox._queueResultCache.set(rowIdA, { sev: sevA, ts: Date.now() });
    sandbox._queueResultCache.set(rowIdB, { sev: sevB, ts: Date.now() });
    sandbox.injectResultChip(0, sevA);
    sandbox.injectResultChip(1, sevB);
    check(
      rowA.wrap.querySelectorAll('.ch-q-result').length === 1 &&
        rowB.wrap.querySelectorAll('.ch-q-result').length === 1,
      'setup: both rows carry their result chip before the churn'
    );

    // Vue re-render wipes every foreign node wholesale, exactly like the
    // real regression: strip ALL chip nodes from the grid.
    gridRoot.querySelectorAll('.ch-q-result, .ch-q-mon, .ch-queue-chips').forEach((n) => n.remove());
    check(
      gridRoot.querySelectorAll('.ch-q-result').length === 0,
      'churn: wipe removed every injected result-chip node from the grid'
    );

    // Drive the durable re-inject path (what refreshQueueChips calls).
    sandbox.reinjectCachedResultChips();
    check(
      rowA.wrap.querySelectorAll('.ch-q-result').length === 1,
      'reinjectCachedResultChips: row A chip restored after churn'
    );
    check(
      rowB.wrap.querySelectorAll('.ch-q-result').length === 1,
      'reinjectCachedResultChips: row B chip restored after churn'
    );
    check(
      rowA.wrap.firstChild.classes.includes('ch-q-result') && rowA.wrap.firstChild.innerHTML.includes('Potassium'),
      "reinjectCachedResultChips: row A's restored chip carries row A's own cached severity (Potassium), not row B's"
    );
    check(
      rowB.wrap.firstChild.classes.includes('ch-q-result') && rowB.wrap.firstChild.innerHTML.includes('Sodium'),
      "reinjectCachedResultChips: row B's restored chip carries row B's own cached severity (Sodium), not row A's"
    );

    // Same churn/restore story for the monitoring family.
    sandbox._queueMonCache.set(rowIdA, { result: { level: 'red', count: 1 }, ts: Date.now() });
    sandbox.injectQueueMonitoringChip(0, { level: 'red', count: 1 });
    check(
      rowA.wrap.querySelectorAll('.ch-q-mon').length === 1,
      'setup: row A carries its monitoring chip before churn'
    );
    gridRoot.querySelectorAll('.ch-q-mon').forEach((n) => n.remove());
    check(rowA.wrap.querySelectorAll('.ch-q-mon').length === 0, 'churn: monitoring chip wiped');
    sandbox.reinjectCachedMonitoringChips();
    check(
      rowA.wrap.querySelectorAll('.ch-q-mon').length === 1,
      'reinjectCachedMonitoringChips: row A monitoring chip restored after churn'
    );

    // And the age/decoration family via the same refreshQueueChips sequence
    // (wipe -> clear decorated flags -> decorateQueueRows).
    sandbox.decorateOneRow(rowA.master);
    check(rowA.wrap.querySelectorAll('.ch-queue-chips').length === 1, 'setup: row A carries its age-chip strip');
    gridRoot.querySelectorAll('.ch-queue-chips').forEach((n) => n.remove());
    delete rowA.master.dataset.chQDec;
    sandbox.decorateQueueRows();
    check(
      rowA.wrap.querySelectorAll('.ch-queue-chips').length === 1,
      'decorateQueueRows: age-chip strip restored after churn (DOM-driven — no cache/durable-map dependency, per CLAUDE.md)'
    );
  }

  // ============================================================
  // Layer 5 — flat fallback host (no preview row): patientName cell,
  // inline width-capped class, still PREPEND
  // ============================================================
  console.log('\nLayer 5: flat fallback host (no preview row) — [col-id="patientName"], inline class, PREPEND');

  {
    freshCaches();
    const rowId = 'ffffffff-0000-4111-8222-333333333333';
    const { master, nameCell } = buildFlatRow({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master); // no detail/preview row at all
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox.injectResultChip(0, redSev);
    check(
      nameCell.children.length === 2,
      'flat fallback: chip hosted in [col-id="patientName"] (no preview row present)'
    );
    check(
      nameCell.firstChild && nameCell.firstChild.classes.includes('ch-q-result'),
      'flat fallback: still PREPENDED — chip is firstChild ahead of the patient name span'
    );
    check(
      nameCell.firstChild.classes.includes('ch-q-result-inline'),
      'flat fallback: gets the width-capped inline class (CLAUDE.md rule #2) so the name is not pushed out'
    );
  }

  // ============================================================
  // Layer 6 — v3.69 regression class: chip lands on the row the DURABLE
  // MAP says, never on a row merely because its row-id looks like a UUID
  // ============================================================
  console.log(
    '\nLayer 6: v3.69 regression class — keyed by _durableRowMap, NOT by row-id (even when row-id looks like a UUID)'
  );

  {
    freshCaches();
    // The row's OWN row-id is a plausible-looking UUID — but it is NOT the
    // task's real taskUuid. Per CLAUDE.md: "row-id is NOT the task UUID on
    // real Medicus — do not key off it."
    const rowLookalikeId = '11111111-1111-4111-8111-111111111111';
    const realTaskUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const { master, nameCell } = buildFlatRow({ rowIndex: 0, rowId: rowLookalikeId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    // The durable map (written ONLY by the bridge task-list event) says
    // rowIndex 0 -> the REAL taskUuid.
    sandbox._durableRowMap.set(0, realTaskUuid);
    sandbox._queueResultCache.set(realTaskUuid, {
      sev: { ...redSev, top: { name: 'RealAnalyte', value: '9', unit: 'x10^9/L' } },
      ts: Date.now(),
    });
    // Decoy: an entry keyed by the row's OWN row-id (the wrong key, the
    // v3.69 no-op bug's shape). If the code regressed to keying off row-id
    // instead of the durable map, THIS is what would render instead.
    sandbox._queueResultCache.set(rowLookalikeId, {
      sev: {
        level: 'amber',
        urgentCount: 0,
        abnormalCount: 1,
        top: { name: 'DECOY', value: '1', unit: '' },
        misprioritised: false,
        unmatched: false,
      },
      ts: Date.now(),
    });

    sandbox.reinjectCachedResultChips();
    check(nameCell.children.length === 2, 'v3.69 class: a chip was injected onto the row (durable map resolved)');
    const html = nameCell.firstChild ? nameCell.firstChild.innerHTML : '';
    check(
      html.includes('RealAnalyte'),
      `v3.69 class: chip carries the durable-map-resolved severity, "RealAnalyte" (got: ${html})`
    );
    check(
      !html.includes('DECOY'),
      `v3.69 class: chip does NOT carry the row-id-keyed decoy severity, "DECOY" (got: ${html})`
    );

    // Same class of check for the monitoring family.
    sandbox._queueMonCache.set(realTaskUuid, { result: { level: 'red', count: 3 }, ts: Date.now() });
    sandbox._queueMonCache.set(rowLookalikeId, { result: { level: 'amber', count: 99 }, ts: Date.now() });
    sandbox.reinjectCachedMonitoringChips();
    const monHtml = nameCell.children.find((c) => c.classes.includes('ch-q-mon'));
    check(!!monHtml, 'v3.69 class (monitoring): a monitoring chip was injected onto the row (durable map resolved)');
    check(
      monHtml && monHtml.innerHTML.includes('count&quot;:3') && !monHtml.innerHTML.includes('99'),
      `v3.69 class (monitoring): chip carries the durable-map-resolved count (3), not the row-id-keyed decoy's count (99) (got: ${monHtml && monHtml.innerHTML})`
    );
  }

  // ============================================================
  // Layer 7 — a row with NO durable-map entry gets nothing (defensive:
  // no fallback to row-id, no stale/wrong chip)
  // ============================================================
  console.log('\nLayer 7: row absent from _durableRowMap gets no chip (no row-id fallback)');

  {
    freshCaches();
    const rowId = '22222222-2222-4222-8222-222222222222';
    const { master, nameCell } = buildFlatRow({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    // Cache has an entry keyed by the row's OWN row-id, but the durable map
    // (rowIndex -> taskUuid) has nothing for rowIndex 0.
    sandbox._queueResultCache.set(rowId, { sev: redSev, ts: Date.now() });
    sandbox.reinjectCachedResultChips();
    check(
      nameCell.children.length === 1,
      `no durable-map entry: nothing injected even though a row-id-keyed cache entry exists (got ${nameCell.children.length} children)`
    );
  }

  // ============================================================
  // Layer 7b — "couldn't check" error chip (item 1.1 leg D,
  // TRIAGE-LENS-2026-07-02.md): a genuinely-failed per-row fetch/eval caches
  // { sev: null, error: true, ts } and renders a grey "?" chip — distinct from
  // both a real severity chip and the "still pending" nothing-at-all state.
  // ============================================================
  console.log('\nLayer 7b: "couldn\'t check" error chip — render, de-dupe, churn survival, TTL expiry, never tints');

  {
    // ---- a live (non-expired) error entry renders the grey "?" chip ----
    freshCaches();
    const rowId = '33333333-3333-4333-8333-333333333333';
    const { master, detail, wrap } = buildPreviewRowPair({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox._durableRowMap.set(0, rowId);
    sandbox._queueResultCache.set(rowId, { sev: null, error: true, ts: Date.now() });
    sandbox.reinjectCachedResultChips();
    check(
      wrap.querySelectorAll('.ch-q-result').length === 1,
      `error entry: grey chip rendered from cache (got ${wrap.querySelectorAll('.ch-q-result').length} .ch-q-result spans)`
    );
    check(
      wrap.firstChild && wrap.firstChild.classes.includes('ch-q-result'),
      'error entry: chip is still hosted/PREPENDED via the normal ch-q-result path'
    );
    const errHtml = wrap.firstChild ? wrap.firstChild.innerHTML : '';
    check(
      /ch-chip-meta/.test(errHtml) && /ch-chip-error/.test(errHtml),
      `error entry: inner chip carries ch-chip-meta + ch-chip-error (grey outline family) (got: ${errHtml})`
    );
    check(
      !/ch-chip-red|ch-chip-amber|ch-chip-green/.test(errHtml),
      'error entry: chip carries NO clinical severity fill class — never mistaken for a graded result'
    );

    // ---- de-dupe: calling injectResultChip for the error chip twice is a no-op ----
    sandbox.injectResultChip(0, null, true);
    check(
      wrap.querySelectorAll('.ch-q-result').length === 1,
      'error entry: injectResultChip called again does not duplicate (still 1 .ch-q-result span)'
    );

    // ---- survives SPA churn via the same durable re-inject path ----
    gridRoot.querySelectorAll('.ch-q-result').forEach((n) => n.remove());
    check(wrap.querySelectorAll('.ch-q-result').length === 0, 'error entry churn: wipe removed the error chip node');
    sandbox.reinjectCachedResultChips();
    check(
      wrap.querySelectorAll('.ch-q-result').length === 1,
      'error entry churn: reinjectCachedResultChips restores the grey chip after the wipe'
    );

    // ---- an EXPIRED error entry (older than _RESULT_ERROR_TTL) renders nothing ----
    freshCaches();
    const rowIdExpired = '44444444-4444-4444-8444-444444444444';
    const rExpired = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdExpired, dob: '01 Jan 1980 (46y)' });
    const gridRoot2 = new El('div', {});
    gridRoot2.appendChild(rExpired.master);
    gridRoot2.appendChild(rExpired.detail);
    sandbox.document = makeDocument(gridRoot2);
    sandbox.queueObservedContainer = gridRoot2;

    sandbox._durableRowMap.set(0, rowIdExpired);
    // ts older than _RESULT_ERROR_TTL (60s) but well inside the normal
    // _RESULT_CACHE_TTL (5min) — proves the error path uses its OWN short TTL,
    // not the long one a real result gets.
    sandbox._queueResultCache.set(rowIdExpired, { sev: null, error: true, ts: Date.now() - 90 * 1000 });
    sandbox.reinjectCachedResultChips();
    check(
      rExpired.wrap.querySelectorAll('.ch-q-result').length === 0,
      'expired error entry: renders NOTHING (treated as not-cached so the scheduler retries it)'
    );

    // ---- an error entry never tints the row (sev stays null throughout) ----
    freshCaches();
    const rowIdTint = '55555555-5555-4555-8555-555555555555';
    const rTint = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdTint, dob: '01 Jan 1980 (46y)' });
    const gridRoot3 = new El('div', {});
    gridRoot3.appendChild(rTint.master);
    gridRoot3.appendChild(rTint.detail);
    sandbox.document = makeDocument(gridRoot3);
    sandbox.queueObservedContainer = gridRoot3;

    sandbox._durableRowMap.set(0, rowIdTint);
    sandbox._queueResultCache.set(rowIdTint, { sev: null, error: true, ts: Date.now() });
    sandbox.reapplyQueueRowTint();
    check(
      !rTint.master.classes.includes('ch-row-sev-red') && !rTint.master.classes.includes('ch-row-sev-amber'),
      'error entry: reapplyQueueRowTint never tints the row (entry.sev stays null for an error entry)'
    );
    check(
      !rTint.detail.classes.includes('ch-row-sev-red') && !rTint.detail.classes.includes('ch-row-sev-amber'),
      'error entry: preview/detail row is not tinted either'
    );
  }

  // ============================================================
  // Layer 8 — severity row tint (item 1.3, TRIAGE-LENS-2026-07-02.md):
  // marker class on .ag-row (+ its preview row), keyed off the SAME durable
  // map/cache as the result chips, cleared+reapplied every churn cycle, gated
  // on prefs.queueRowTint.
  // ============================================================
  console.log('\nLayer 8: severity row tint — cached red/amber, unknown rows, churn, recycled row-index, pref gate');

  {
    // ---- tinted on cached red/amber ----
    freshCaches();
    const rowIdRed = 'a0000000-0000-4000-8000-000000000001';
    const rowIdAmber = 'a0000000-0000-4000-8000-000000000002';
    const rowRed = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdRed, dob: '01 Jan 1980 (46y)' });
    const rowAmber = buildPreviewRowPair({ rowIndex: 1, rowId: rowIdAmber, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    [rowRed, rowAmber].forEach(({ master, detail }) => {
      gridRoot.appendChild(master);
      gridRoot.appendChild(detail);
    });
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox._durableRowMap.set(0, rowIdRed);
    sandbox._durableRowMap.set(1, rowIdAmber);
    sandbox._queueResultCache.set(rowIdRed, { sev: redSev, ts: Date.now() });
    sandbox._queueResultCache.set(rowIdAmber, { sev: amberSev, ts: Date.now() });

    sandbox.reapplyQueueRowTint();
    check(
      rowRed.master.classes.includes('ch-row-sev-red'),
      'reapplyQueueRowTint: red-cached master row gets ch-row-sev-red'
    );
    check(
      rowRed.detail.classes.includes('ch-row-sev-red'),
      'reapplyQueueRowTint: red-cached preview/detail row ALSO gets ch-row-sev-red'
    );
    check(
      !rowRed.master.classes.includes('ch-row-sev-amber'),
      'reapplyQueueRowTint: red-cached row does not also carry the amber class'
    );
    check(
      rowAmber.master.classes.includes('ch-row-sev-amber'),
      'reapplyQueueRowTint: amber-cached master row gets ch-row-sev-amber'
    );
    check(
      rowAmber.detail.classes.includes('ch-row-sev-amber'),
      'reapplyQueueRowTint: amber-cached preview/detail row ALSO gets ch-row-sev-amber'
    );

    // ---- no tint for unknown rows (no cache entry / null sev / level 'none') ----
    freshCaches();
    const rowIdUnknown1 = 'a0000000-0000-4000-8000-000000000003'; // no durable-map entry at all
    const rowIdUnknown2 = 'a0000000-0000-4000-8000-000000000004'; // durable-map entry, no cache entry
    const rowIdUnknown3 = 'a0000000-0000-4000-8000-000000000005'; // cached but sev===null (failed fetch)
    const rowIdUnknown4 = 'a0000000-0000-4000-8000-000000000006'; // cached, level==='none'
    const rU1 = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdUnknown1, dob: '01 Jan 1980 (46y)' });
    const rU2 = buildPreviewRowPair({ rowIndex: 1, rowId: rowIdUnknown2, dob: '01 Jan 1980 (46y)' });
    const rU3 = buildPreviewRowPair({ rowIndex: 2, rowId: rowIdUnknown3, dob: '01 Jan 1980 (46y)' });
    const rU4 = buildPreviewRowPair({ rowIndex: 3, rowId: rowIdUnknown4, dob: '01 Jan 1980 (46y)' });
    const gridRoot2 = new El('div', {});
    [rU1, rU2, rU3, rU4].forEach(({ master, detail }) => {
      gridRoot2.appendChild(master);
      gridRoot2.appendChild(detail);
    });
    sandbox.document = makeDocument(gridRoot2);
    sandbox.queueObservedContainer = gridRoot2;

    // rowIndex 0: nothing in the durable map at all.
    sandbox._durableRowMap.set(1, rowIdUnknown2); // durable entry, but no cache entry below
    sandbox._durableRowMap.set(2, rowIdUnknown3);
    sandbox._queueResultCache.set(rowIdUnknown3, { sev: null, ts: Date.now() });
    sandbox._durableRowMap.set(3, rowIdUnknown4);
    sandbox._queueResultCache.set(rowIdUnknown4, { sev: noneSev, ts: Date.now() });

    sandbox.reapplyQueueRowTint();
    for (const [label, r] of [
      ['no durable-map entry', rU1],
      ['durable entry but no cache entry', rU2],
      ['cached null sev (failed fetch)', rU3],
      ["cached level 'none'", rU4],
    ]) {
      check(
        !r.master.classes.includes('ch-row-sev-red') && !r.master.classes.includes('ch-row-sev-amber'),
        `reapplyQueueRowTint: ${label} -> master row gets NEITHER tint class (never implies "assessed")`
      );
      check(
        !r.detail.classes.includes('ch-row-sev-red') && !r.detail.classes.includes('ch-row-sev-amber'),
        `reapplyQueueRowTint: ${label} -> preview row gets NEITHER tint class either`
      );
    }

    // ---- tint cleared and reapplied on the churn cycle ----
    freshCaches();
    const rowIdChurn = 'a0000000-0000-4000-8000-000000000007';
    const rowChurn = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdChurn, dob: '01 Jan 1980 (46y)' });
    const gridRoot3 = new El('div', {});
    gridRoot3.appendChild(rowChurn.master);
    gridRoot3.appendChild(rowChurn.detail);
    sandbox.document = makeDocument(gridRoot3);
    sandbox.queueObservedContainer = gridRoot3;

    sandbox._durableRowMap.set(0, rowIdChurn);
    sandbox._queueResultCache.set(rowIdChurn, { sev: redSev, ts: Date.now() });
    sandbox.reapplyQueueRowTint();
    check(rowChurn.master.classes.includes('ch-row-sev-red'), 'churn setup: row tinted red before the churn cycle');

    // Simulate the SAME wipe/reapply sequence refreshQueueChips runs on every
    // Vue re-render — clear must remove it, reapply must restore it (immune to
    // the fact that AG-Grid never actually strips CLASSES the way it strips DOM
    // nodes, so an untested clear() would silently mask a real regression).
    sandbox.clearQueueRowTint();
    check(
      !rowChurn.master.classes.includes('ch-row-sev-red') && !rowChurn.master.classes.includes('ch-row-sev-amber'),
      'clearQueueRowTint: tint classes removed from the row on the wipe half of the cycle'
    );
    check(
      !rowChurn.detail.classes.includes('ch-row-sev-red'),
      'clearQueueRowTint: tint classes removed from the preview row too'
    );
    sandbox.reapplyQueueRowTint();
    check(
      rowChurn.master.classes.includes('ch-row-sev-red'),
      'reapplyQueueRowTint: tint restored on the SAME row after the wipe (churn cycle survives)'
    );

    // ---- recycled row-index with a DIFFERENT taskUuid never keeps the old tint ----
    // AG-Grid reuses row-index DOM nodes for a different patient/task once the
    // queue re-sorts. If clear+reapply didn't run together, row-index 0 could
    // keep yesterday's red tint on today's (calm) patient — the tint analogue
    // of the v3.69 wrong-row chip bug.
    const rowIdNewPatient = 'a0000000-0000-4000-8000-000000000008';
    sandbox._durableRowMap.set(0, rowIdNewPatient); // same row-index, different task
    sandbox._queueResultCache.set(rowIdNewPatient, { sev: amberSev, ts: Date.now() });
    // Full cycle: wipe, then reapply from the now-updated durable map/cache.
    sandbox.clearQueueRowTint();
    sandbox.reapplyQueueRowTint();
    check(
      !rowChurn.master.classes.includes('ch-row-sev-red'),
      'recycled row-index: the OLD patient\'s red tint is gone'
    );
    check(
      rowChurn.master.classes.includes('ch-row-sev-amber'),
      "recycled row-index: the row now carries the NEW patient's amber tint"
    );

    // Recycle again, this time onto a task with NO cached severity at all —
    // the row must end up with NO tint, not a stuck amber from the previous cycle.
    const rowIdNewPatientNoSev = 'a0000000-0000-4000-8000-000000000009';
    sandbox._durableRowMap.set(0, rowIdNewPatientNoSev);
    sandbox.clearQueueRowTint();
    sandbox.reapplyQueueRowTint();
    check(
      !rowChurn.master.classes.includes('ch-row-sev-red') && !rowChurn.master.classes.includes('ch-row-sev-amber'),
      'recycled row-index onto an unassessed task: no tint at all survives (not stuck amber)'
    );

    // ---- pref off = no tint ----
    freshCaches();
    sandbox.CONFIG = { prefs: { queueRowTint: false } };
    const rowIdPrefOff = 'a0000000-0000-4000-8000-00000000000a';
    const rowPrefOff = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdPrefOff, dob: '01 Jan 1980 (46y)' });
    const gridRoot4 = new El('div', {});
    gridRoot4.appendChild(rowPrefOff.master);
    gridRoot4.appendChild(rowPrefOff.detail);
    sandbox.document = makeDocument(gridRoot4);
    sandbox.queueObservedContainer = gridRoot4;

    sandbox._durableRowMap.set(0, rowIdPrefOff);
    sandbox._queueResultCache.set(rowIdPrefOff, { sev: redSev, ts: Date.now() });
    sandbox.reapplyQueueRowTint();
    check(
      !rowPrefOff.master.classes.includes('ch-row-sev-red') && !rowPrefOff.master.classes.includes('ch-row-sev-amber'),
      'prefs.queueRowTint=false: reapplyQueueRowTint is a no-op even though a red-cached row exists'
    );
    sandbox.CONFIG = {}; // restore default for any tests that might run after this block
  }
} else {
  console.error('\nSandbox extraction failed — skipping all behavioural layers.');
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
