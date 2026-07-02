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
      add: (c) => {
        if (!self.classes.includes(c)) self.classes.push(c);
      },
      remove: (c) => {
        self.classes = self.classes.filter((x) => x !== c);
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
  extract(/const QUEUE_DECORATED_KEY = .*;/, 'QUEUE_DECORATED_KEY'),
  extract(/function selectResultChips\(sev\) \{[\s\S]*?\n {2}\}/, 'selectResultChips'),
  extract(/const renderSystemChipHtmlMemo = \(id, vars\) => \{[\s\S]*?\n {2}\};/, 'renderSystemChipHtmlMemo'),
  extract(/const findQueuePreviewRow = \(row\) => \{[\s\S]*?\n {2}\};/, 'findQueuePreviewRow'),
  extract(/const queueChipHost = \(row, marker\) => \{[\s\S]*?\n {2}\};/, 'queueChipHost'),
  extract(/const decorateOneRow = \(row\) => \{[\s\S]*?\n {2}\};/, 'decorateOneRow'),
  extract(/const decorateQueueRows = \(\) => \{[\s\S]*?\n {2}\};/, 'decorateQueueRows'),
  extract(/const queueScope = \(\)[\s\S]*?;/, 'queueScope'),
  extract(/const injectResultChip = \(rowIndex, sev\) => \{[\s\S]*?\n {2}\};/, 'injectResultChip'),
  extract(/const reinjectCachedResultChips = \(\) => \{[\s\S]*?\n {2}\};/, 'reinjectCachedResultChips'),
  extract(/const injectQueueMonitoringChip = \(rowIndex, result\) => \{[\s\S]*?\n {2}\};/, 'injectQueueMonitoringChip'),
  extract(/const reinjectCachedMonitoringChips = \(\) => \{[\s\S]*?\n {2}\};/, 'reinjectCachedMonitoringChips'),
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

function freshCaches() {
  sandbox._chipHtmlMemo = new Map();
  sandbox._durableRowMap = new Map();
  sandbox._queueResultCache = new Map();
  sandbox._queueMonCache = new Map();
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
} else {
  console.error('\nSandbox extraction failed — skipping all behavioural layers.');
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
