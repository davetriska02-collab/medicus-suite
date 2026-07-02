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
// QUEUE_DECORATED_KEY). Item 1.3 added clearQueueRowTint/reapplyQueueRowTint.
// Item 1.2 (TRIAGE-LENS-2026-07-02.md) added the queue triage status bar:
// computeQueueTriageCounts, nextAlertRowIndex, getQueueTintedRowIndexes,
// ensureQueueStatusBarEl, removeQueueStatusBar, applyQueueFocusClass,
// renderQueueStatusBar, updateQueueStatusBar, onQueueStatusJumpClick,
// onQueueStatusFocusClick, plus their small consts/module state
// (QUEUE_STATUS_BAR_ID, QUEUE_STATUS_FLASH_CLASS, QUEUE_FOCUS_CLASS,
// QUEUE_STATUS_TOOLTIP, the _queueStatus*/_queueFocusAlertsOn/
// _queueStatusBarRafPending module `let`s).
//
// STUBBED (deliberately, not injection mechanics — already covered by other
// test files): getSystemChip/matchRules (chip *content*/enable-state is
// exercised via selectResultChips in test-result-triage-queue.js Layer 1 and
// selectMonitoringDue in test-monitoring-chip.js Layer 2), showActionMenu
// (only reachable via a click we never simulate), log (console noise).
// requestAnimationFrame is stubbed to run its callback SYNCHRONOUSLY (real
// content.js falls back to setTimeout(fn,0) when rAF is unavailable — this
// harness instead makes updateQueueStatusBar's rAF-coalescing deterministic
// for assertions rather than exercising the async fallback path itself,
// which is a timing/perf concern out of scope for a DOM-injection harness).
//
// NOT COVERED HERE (documented, not faked):
//   - computeQueueRowResult / computeQueueRowMonitoring / the fetch
//     schedulers (scheduleQueueResultTriage / scheduleQueueMonitoring) —
//     network + engine evaluation, out of scope for a DOM-injection
//     harness; that pipeline's wiring is source-verified in
//     test-result-triage-queue.js Layers 3/3b/3c. The item 1.2 "call
//     updateQueueStatusBar() from inside the worker loop after each cache
//     write" wiring is likewise source-verified there, not re-driven here.
//   - refreshQueueChips itself — it also owns the MutationObserver
//     lifecycle (disconnect/observe/setupQueueObserver/removeQueueStatusBar),
//     which needs a real MutationObserver to exercise meaningfully. Instead
//     this harness replicates its DOM-relevant SEQUENCE directly (wipe chip
//     nodes -> decorateQueueRows -> reinjectCachedResultChips ->
//     reinjectCachedMonitoringChips, the same three calls refreshQueueChips
//     makes) so the actual regression surface — "does re-inject restore the
//     right chip on the right row after Vue wipes the DOM" — is exercised
//     behaviourally, while the observer-rearming plumbing stays covered by
//     the existing source-grep in test-result-triage-queue.js Layer 3. The
//     same applies to runQueue's status-bar reset/re-assert calls
//     (_queueStatusJumpPos=null, applyQueueFocusClass()) and
//     teardownQueueObserver's removeQueueStatusBar()/focus-class cleanup —
//     source-verified, not re-driven behaviourally here.
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
    // showRuleMatchMenu (items 2.1/2.3/2.5) positions its popover via
    // menu.style.{position,top,left,zIndex} — a plain mutable object is
    // enough; nothing here asserts on actual rendered position.
    this.style = {};
    if (attrs) for (const k of Object.keys(attrs)) this.setAttribute(k, attrs[k]);
  }
  setAttribute(name, value) {
    if (name === 'class') this.classes = String(value).split(/\s+/).filter(Boolean);
    else this.attrs[name] = String(value);
    // Real DOM reflects data-* attributes into .dataset (kebab-case ->
    // camelCase) bidirectionally. The rule-match chip wiring (items 2.1/
    // 2.3/2.5) sets data-rq-idx via setAttribute (so the [data-rq-idx]
    // attribute-selector querySelectorAll below still finds it) and reads it
    // back via el.dataset.rqIdx — mirror that one-way reflection here so
    // both call sites work against this fake DOM the same way they do on a
    // real page.
    if (name.indexOf('data-') === 0) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(value);
    }
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
      // Real classList.toggle(token, force) — item 1.2's status bar/focus-mode
      // code uses the 2-arg boolean-force form throughout (never the 1-arg
      // flip form), so that's the only shape implemented here.
      toggle: (c, force) => {
        const has = self.classes.includes(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) self.classes.push(c);
        else if (!want && has) self.classes = self.classes.filter((x) => x !== c);
        return want;
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
  removeEventListener() {}
  dispatchEvent() {}
  // Real element.click() dispatches a click event to registered listeners —
  // used below to simulate a GP clicking a rule-match/menu chip without
  // needing a real click-event pipeline.
  click() {
    (this._listeners.click || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} }));
  }
  // Items 2.1/2.3/2.5's showRuleMatchMenu positions the popover off the
  // anchor's rect — a fixed zero rect is fine, nothing here asserts on
  // pixel position.
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
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

// `body` mirrors document.body: a stable wrapper the grid root is mounted
// inside of, so status-bar code (item 1.2) that does
// `document.body.appendChild(...)` / `document.getElementById(...)` has
// somewhere real to land, exactly like the live page — the grid root is a
// DESCENDANT of body, not a stand-in for it, so search scope only grows
// (existing per-layer assertions against `rootEl`'s own subtree are
// unaffected: body's subtree is a strict superset).
function makeDocument(rootEl) {
  const body = new El('body');
  if (rootEl) body.appendChild(rootEl);
  return {
    __root: rootEl,
    body,
    createElement(tag) {
      return new El(tag);
    },
    // renderRuleMenuActionItems (items 2.1/2.3/2.5) builds its action-item
    // list in a DocumentFragment before appending it once. A plain container
    // El is a faithful-enough stand-in here: unlike a real fragment it stays
    // as an extra node in the tree rather than being unwrapped on insertion,
    // but querySelector/querySelectorAll (used by every assertion in this
    // harness) recurse through descendants regardless of nesting depth, so
    // that difference is invisible to the tests.
    createDocumentFragment() {
      return new El('#fragment');
    },
    // buildRuleMatchChipEl/buildEvidenceEl (items 2.1/2.3/2.5) build via
    // createTextNode rather than innerHTML (the evidence text is untrusted
    // row-derived content — CLAUDE.md's textContent-only discipline).
    createTextNode(text) {
      const t = new El('#text');
      t.textContent = text;
      return t;
    },
    querySelector(sel) {
      return findFirst(body, sel);
    },
    querySelectorAll(sel) {
      return findAll(body, sel);
    },
    getElementById(id) {
      return collectDescendants(body, []).find((n) => n.id === id) || null;
    },
    contains(node) {
      if (node === rootEl || node === body) return true;
      let p = node && node.parent;
      while (p) {
        if (p === rootEl || p === body) return true;
        p = p.parent;
      }
      return false;
    },
    // closeActionMenu/armActionMenuDismissal (items 2.1/2.3/2.5) register/
    // unregister outside-click and Esc listeners on `document` — no-ops here
    // since this harness drives the menu functions directly rather than
    // simulating a real click-outside/keydown event pipeline.
    addEventListener() {},
    removeEventListener() {},
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
  // Item 1.2 — queue triage status bar (docs/plans/TRIAGE-LENS-2026-07-02.md).
  extract(
    /const computeQueueTriageCounts = \(durableMap, cache, visibleRowIndexes, now\) => \{[\s\S]*?\n {2}\};/,
    'computeQueueTriageCounts'
  ),
  extract(
    /const nextAlertRowIndex = \(currentPos, redIndexes, amberIndexes\) => \{[\s\S]*?\n {2}\};/,
    'nextAlertRowIndex'
  ),
  extract(/const getQueueTintedRowIndexes = \(\) => \{[\s\S]*?\n {2}\};/, 'getQueueTintedRowIndexes'),
  extract(/const QUEUE_STATUS_BAR_ID = .*;/, 'QUEUE_STATUS_BAR_ID'),
  extract(/const QUEUE_STATUS_FLASH_CLASS = .*;/, 'QUEUE_STATUS_FLASH_CLASS'),
  extract(/const QUEUE_FOCUS_CLASS = .*;/, 'QUEUE_FOCUS_CLASS'),
  extract(/const QUEUE_STATUS_TOOLTIP =[\s\S]*?;/, 'QUEUE_STATUS_TOOLTIP'),
  extract(
    /let _queueStatusJumpPos = null;[\s\S]*?let _queueStatusBarRafPending = false;/,
    '_queueStatus* module state'
  ),
  extract(/const onQueueStatusJumpClick = \(\) => \{[\s\S]*?\n {2}\};/, 'onQueueStatusJumpClick'),
  extract(/const onQueueStatusFocusClick = \(e\) => \{[\s\S]*?\n {2}\};/, 'onQueueStatusFocusClick'),
  extract(/const ensureQueueStatusBarEl = \(\) => \{[\s\S]*?\n {2}\};/, 'ensureQueueStatusBarEl'),
  extract(/const removeQueueStatusBar = \(\) => \{[\s\S]*?\n {2}\};/, 'removeQueueStatusBar'),
  extract(/const applyQueueFocusClass = \(\) => \{[\s\S]*?\n {2}\};/, 'applyQueueFocusClass'),
  extract(/const renderQueueStatusBar = \(\) => \{[\s\S]*?\n {2}\};/, 'renderQueueStatusBar'),
  extract(/const updateQueueStatusBar = \(\) => \{[\s\S]*?\n {2}\};/, 'updateQueueStatusBar'),
  // Items 2.1/2.3/2.5 (TRIAGE-LENS-2026-07-02.md) — ranked/collapsed
  // rule-match chips (decorateOneRow's rule-chip section) + the rule-match
  // evidence/actions menu they open.
  extract(/const RULE_KIND_RANK = \{[\s\S]*?\};/, 'RULE_KIND_RANK'),
  extract(/const rankRuleMatches = \(rules\) =>[\s\S]*?\.map\(\(x\) => x\.r\);/, 'rankRuleMatches'),
  extract(/const buildRuleMatchChipEl = \(chip\) => \{[\s\S]*?\n {2}\};/, 'buildRuleMatchChipEl'),
  extract(/let activeActionMenu = null;[\s\S]*?let activeAnchorEl = null;/, 'activeActionMenu/activeAnchorEl state'),
  extract(/const closeActionMenu = \(\) => \{[\s\S]*?\n {2}\};/, 'closeActionMenu'),
  extract(/const onDocClickForMenu = \(e\) => \{[\s\S]*?\n {2}\};/, 'onDocClickForMenu'),
  extract(/const onKeydownForMenu = \(e\) => \{[\s\S]*?\n {2}\};/, 'onKeydownForMenu'),
  extract(/const onScrollForMenu = \(\) => closeActionMenu\(\);/, 'onScrollForMenu'),
  extract(/const armActionMenuDismissal = \(\) => \{[\s\S]*?\n {2}\};/, 'armActionMenuDismissal'),
  extract(/const isSafeActionUrl = \(url\) => \{[\s\S]*?\n {2}\};/, 'isSafeActionUrl'),
  extract(/const executeAction = \(action, anchorEl, menuEl\) => \{[\s\S]*?\n {2}\};/, 'executeAction'),
  extract(/const buildEvidenceEl = \(rule, previewText\) => \{[\s\S]*?\n {2}\};/, 'buildEvidenceEl'),
  extract(/const RULE_MENU_ACTION_ICONS = \{[\s\S]*?\};/, 'RULE_MENU_ACTION_ICONS'),
  extract(/const renderRuleMenuActionItems = \(rule\) => \{[\s\S]*?\n {2}\};/, 'renderRuleMenuActionItems'),
  extract(
    /const renderRuleMenuDetail = \(rule, previewText, rules, showBack\) => \{[\s\S]*?\n {2}\};/,
    'renderRuleMenuDetail'
  ),
  extract(/const renderRuleMenuList = \(rules, previewText\) => \{[\s\S]*?\n {2}\};/, 'renderRuleMenuList'),
  extract(
    /const showRuleMatchMenu = \(anchor, rules, previewText, openList\) => \{[\s\S]*?\n {2}\};/,
    'showRuleMatchMenu'
  ),
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
  'computeQueueTriageCounts',
  'nextAlertRowIndex',
  'getQueueTintedRowIndexes',
  'onQueueStatusJumpClick',
  'onQueueStatusFocusClick',
  'ensureQueueStatusBarEl',
  'removeQueueStatusBar',
  'applyQueueFocusClass',
  'renderQueueStatusBar',
  'updateQueueStatusBar',
  'rankRuleMatches',
  'buildRuleMatchChipEl',
  'closeActionMenu',
  'showRuleMatchMenu',
  'renderRuleMenuList',
  'renderRuleMenuDetail',
  'buildEvidenceEl',
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
    // Item 1.2's updateQueueStatusBar rAF-coalesces; real content.js falls back to
    // setTimeout(fn,0) when rAF is unavailable, but for deterministic assertions
    // this harness runs the callback synchronously instead (see file-header note).
    requestAnimationFrame: (fn) => fn(),
    // Only used by onQueueStatusJumpClick to remove the flash class after 2.6s,
    // and by armActionMenuDismissal (items 2.1/2.3/2.5) to defer registering the
    // outside-click listener — neither is a real event pipeline this harness
    // drives, so the deferred callback simply never runs (fire-and-forget).
    setTimeout: () => {},
    // showRuleMatchMenu (items 2.1/2.3/2.5) positions the popover off
    // window.innerWidth and (de)registers a scroll-dismiss listener; the REAL
    // shared matcher is wired in as TriageLensMatch so buildEvidenceEl's
    // window.TriageLensMatch.ruleMatchEvidence(...) call exercises the actual
    // rule-match.js logic under test, not a stub.
    window: {
      innerWidth: 1200,
      addEventListener: () => {},
      removeEventListener: () => {},
      TriageLensMatch: require('./content-scripts/triage-lens/rule-match.js'),
    },
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
    check(typeof sandbox.computeQueueTriageCounts === 'function', 'computeQueueTriageCounts compiled and callable');
    check(typeof sandbox.nextAlertRowIndex === 'function', 'nextAlertRowIndex compiled and callable');
    check(typeof sandbox.getQueueTintedRowIndexes === 'function', 'getQueueTintedRowIndexes compiled and callable');
    check(typeof sandbox.ensureQueueStatusBarEl === 'function', 'ensureQueueStatusBarEl compiled and callable');
    check(typeof sandbox.removeQueueStatusBar === 'function', 'removeQueueStatusBar compiled and callable');
    check(typeof sandbox.applyQueueFocusClass === 'function', 'applyQueueFocusClass compiled and callable');
    check(typeof sandbox.renderQueueStatusBar === 'function', 'renderQueueStatusBar compiled and callable');
    check(typeof sandbox.updateQueueStatusBar === 'function', 'updateQueueStatusBar compiled and callable');
    check(typeof sandbox.onQueueStatusJumpClick === 'function', 'onQueueStatusJumpClick compiled and callable');
    check(typeof sandbox.onQueueStatusFocusClick === 'function', 'onQueueStatusFocusClick compiled and callable');
    check(typeof sandbox.rankRuleMatches === 'function', 'rankRuleMatches compiled and callable');
    check(typeof sandbox.showRuleMatchMenu === 'function', 'showRuleMatchMenu compiled and callable');
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
      "recycled row-index: the OLD patient's red tint is gone"
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

  // ============================================================
  // Layer 9 — computeQueueTriageCounts (item 1.2, TRIAGE-LENS-2026-07-02.md):
  // pure counting function, all five buckets + TTL expiry moving an entry
  // from a live bucket (error/red) into "checking", + taskUuid dedupe.
  // ============================================================
  console.log(
    '\nLayer 9: computeQueueTriageCounts — five buckets, TTL expiry, dedupe-by-taskUuid, unmapped visible rows'
  );

  {
    const NOW = 1750000000000; // fixed epoch — deterministic TTL-boundary maths
    const durableMap = new Map([
      [0, 'red1'],
      [1, 'amber1'],
      [2, 'clearNone'],
      [3, 'clearNull'],
      [4, 'errFresh'],
      [5, 'errExpired'],
      [6, 'neverFetched'],
      [7, 'noEntry'],
      [8, 'resultExpired'],
      [9, 'red1'], // duplicate taskUuid of row 0 — must dedupe to nothing extra
    ]);
    const cache = new Map([
      ['red1', { sev: redSev, ts: NOW }],
      ['amber1', { sev: amberSev, ts: NOW }],
      ['clearNone', { sev: noneSev, ts: NOW }],
      ['clearNull', { sev: null, ts: NOW }], // definitive "nothing to check", not an error
      ['errFresh', { sev: null, error: true, ts: NOW }],
      // Older than _RESULT_ERROR_TTL (60s) but well inside _RESULT_CACHE_TTL —
      // proves the error bucket uses its OWN short TTL, same as the tint code.
      ['errExpired', { sev: null, error: true, ts: NOW - 90 * 1000 }],
      ['neverFetched', {}], // entry exists, but sev was never set (undefined)
      // 'noEntry' deliberately has NO cache entry at all.
      // Older than _RESULT_CACHE_TTL (5min) — a real result that's gone stale.
      ['resultExpired', { sev: redSev, ts: NOW - 6 * 60 * 1000 }],
    ]);
    // Row 10 is visible in the DOM but the bridge hasn't resolved its taskUuid
    // yet (no durable-map entry) — must count as "checking", not be dropped.
    const visible = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const counts = sandbox.computeQueueTriageCounts(durableMap, cache, visible, NOW);
    check(counts.red === 1, `red bucket: fresh cached red result (got ${counts.red})`);
    check(counts.amber === 1, `amber bucket: fresh cached amber result (got ${counts.amber})`);
    check(counts.clear === 1, `clear bucket: ONLY a fresh level:'none' result counts (got ${counts.clear})`);
    check(
      counts.noResult === 1,
      'noResult bucket: a fresh definitive sev:null non-error entry (nothing to grade) is NOT clear ' +
        `and NOT checking — own non-rendered bucket (got ${counts.noResult})`
    );
    check(counts.error === 1, `couldn't-check bucket: only the FRESH error entry counts (got ${counts.error})`);
    check(
      counts.checking === 5,
      'checking bucket: expired error (TTL moved error->checking) + never-fetched + no-cache-entry + ' +
        `expired result + unmapped-visible-row, all five land here (got ${counts.checking})`
    );
    check(
      counts.total === 10,
      `total: 10 distinct rows counted — the duplicate-taskUuid row (9) contributes to NEITHER bucket NOR the ` +
        `total once its taskUuid has already been seen (got ${counts.total})`
    );

    // ---- explicit "TTL expiry moves an entry from error -> checking" before/after ----
    const errEntry = new Map([['e1', { sev: null, error: true, ts: NOW }]]);
    const errMap = new Map([[0, 'e1']]);
    const before = sandbox.computeQueueTriageCounts(errMap, errEntry, new Set([0]), NOW);
    check(before.error === 1 && before.checking === 0, 'TTL boundary: a fresh error entry counts as "couldn\'t check"');
    const after = sandbox.computeQueueTriageCounts(errMap, errEntry, new Set([0]), NOW + 61 * 1000);
    check(
      after.error === 0 && after.checking === 1,
      'TTL boundary: the SAME entry, 61s later (past _RESULT_ERROR_TTL), moves to "checking" instead'
    );

    // ---- empty union: no known rows at all -> every bucket zero ----
    const empty = sandbox.computeQueueTriageCounts(new Map(), new Map(), new Set(), NOW);
    check(
      empty.red === 0 &&
        empty.amber === 0 &&
        empty.clear === 0 &&
        empty.error === 0 &&
        empty.checking === 0 &&
        empty.total === 0,
      'empty union: no durable-map entries and no visible rows -> every bucket is zero'
    );
  }

  // ============================================================
  // Layer 10 — nextAlertRowIndex (item 1.2): pure jump-order logic — red
  // priority, amber fallback, ascending cycling, wrap-around, both-empty.
  // ============================================================
  console.log('\nLayer 10: nextAlertRowIndex — red priority, amber fallback, ascending cycle, wrap, disabled case');

  {
    check(sandbox.nextAlertRowIndex(null, [], []) === null, 'both lists empty: returns null (caller disables button)');
    check(
      sandbox.nextAlertRowIndex(null, [3, 7, 9], []) === 3,
      'no current position: jumps to the FIRST (lowest row-index) red'
    );
    check(sandbox.nextAlertRowIndex(3, [3, 7, 9], []) === 7, 'cycles ascending: from 3 to the next red, 7');
    check(sandbox.nextAlertRowIndex(9, [3, 7, 9], []) === 3, 'wraps around: from the LAST red back to the first');
    check(
      sandbox.nextAlertRowIndex(100, [3, 7, 9], []) === 3,
      'current position past every red (stale/scrolled away): wraps to the first rather than returning null'
    );
    check(sandbox.nextAlertRowIndex(null, [], [2, 5]) === 2, 'zero reds: falls back to the first amber');
    check(sandbox.nextAlertRowIndex(2, [], [2, 5]) === 5, 'zero reds: amber list cycles the same way reds do');
    check(
      sandbox.nextAlertRowIndex(0, [4], [1, 2, 3]) === 4,
      'ANY reds present, even just one, take priority over ambers — never mixes the two lists'
    );
  }

  // ============================================================
  // Layer 11 — queue status bar: create-once/mutate-in-place, de-dupe,
  // omitted-zero-segments text, "still checking" indicator, PREF gate,
  // tooltip carries the honesty line, rAF-coalesced updateQueueStatusBar.
  // ============================================================
  console.log('\nLayer 11: queue status bar — render, de-dupe, update-in-place, omitted segments, PREF gate');

  {
    freshCaches();
    const rowIdRed = 'b0000000-0000-4000-8000-000000000001';
    const { master, detail } = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdRed, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;
    sandbox._durableRowMap.set(0, rowIdRed);
    sandbox._queueResultCache.set(rowIdRed, { sev: redSev, ts: Date.now() });

    sandbox.renderQueueStatusBar();
    const bar1 = sandbox.document.getElementById('ch-q-status-bar');
    check(!!bar1, 'renderQueueStatusBar: bar element created and appended');
    check(bar1 && bar1.classes.includes('ch-q-status'), 'bar carries the ch-q-status class');
    check(bar1 && bar1.attrs.role === 'status', 'bar has role="status"');
    check(bar1 && bar1.attrs['aria-live'] === 'off', 'bar has aria-live="off" (counts change too often for "polite")');
    check(
      bar1 && /not been assessed as normal/.test(bar1.title || ''),
      "bar tooltip carries the old legend's honesty line"
    );
    const countsEl1 = bar1 && bar1.querySelector('.ch-q-status-counts');
    check(
      countsEl1 && countsEl1.textContent === '1 red · 0 amber',
      `bar text with only a red present, zero everything else: "1 red · 0 amber", zero segments omitted (got: ${countsEl1 && countsEl1.textContent})`
    );
    check(
      !bar1.classes.includes('ch-q-status--checking'),
      'no checking rows: the "still working" indicator class is absent'
    );

    sandbox.renderQueueStatusBar();
    const bar2 = sandbox.document.getElementById('ch-q-status-bar');
    check(bar2 === bar1, 'de-dupe: calling renderQueueStatusBar again does not create a second bar node');
    check(
      sandbox.document.querySelectorAll('.ch-q-status').length === 1,
      'de-dupe: exactly one .ch-q-status element exists in the document'
    );

    // ---- update-in-place: same node reference, text mutates to reflect a new picture ----
    const rowIdAmber = 'b0000000-0000-4000-8000-000000000002';
    const rowAmber = buildPreviewRowPair({ rowIndex: 1, rowId: rowIdAmber, dob: '01 Jan 1980 (46y)' });
    gridRoot.appendChild(rowAmber.master);
    gridRoot.appendChild(rowAmber.detail);
    sandbox._durableRowMap.set(1, rowIdAmber);
    sandbox._queueResultCache.set(rowIdAmber, { sev: null, error: true, ts: Date.now() }); // "couldn't check"
    sandbox.renderQueueStatusBar();
    const bar3 = sandbox.document.getElementById('ch-q-status-bar');
    check(bar3 === bar1, 'update-in-place: still the SAME node reference after the underlying counts changed');
    const countsEl3 = bar3.querySelector('.ch-q-status-counts');
    check(
      countsEl3.textContent === '1 red · 0 amber · 1 ?',
      `bar text updates in place to include the new "?" segment, clear stays omitted (got: ${countsEl3.textContent})`
    );

    // ---- "still checking" — a known row with no live cache entry ----
    const rowIdChecking = 'b0000000-0000-4000-8000-000000000003';
    const rowChecking = buildPreviewRowPair({ rowIndex: 2, rowId: rowIdChecking, dob: '01 Jan 1980 (46y)' });
    gridRoot.appendChild(rowChecking.master);
    gridRoot.appendChild(rowChecking.detail);
    sandbox._durableRowMap.set(2, rowIdChecking); // no cache entry at all yet
    sandbox.renderQueueStatusBar();
    const bar4 = sandbox.document.getElementById('ch-q-status-bar');
    const countsEl4 = bar4.querySelector('.ch-q-status-counts');
    check(
      countsEl4.textContent === '1 red · 0 amber · 1 ? · checking 1…',
      `"checking" segment appended last, with the ellipsis (got: ${countsEl4.textContent})`
    );
    check(
      bar4.classes.includes('ch-q-status--checking'),
      'checking > 0: the "still working" indicator class is present'
    );

    // ---- PREF gate: prefs.queueStatusBar=false removes the bar ----
    sandbox.CONFIG = { prefs: { queueStatusBar: false } };
    sandbox.renderQueueStatusBar();
    check(
      sandbox.document.getElementById('ch-q-status-bar') === null,
      'prefs.queueStatusBar=false: renderQueueStatusBar removes any existing bar and renders nothing'
    );
    sandbox.CONFIG = {};

    // ---- updateQueueStatusBar: rAF-coalesced — N calls in one frame render ONCE ----
    freshCaches();
    const rowIdCoalesce = 'b0000000-0000-4000-8000-000000000004';
    const rowCoalesce = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdCoalesce, dob: '01 Jan 1980 (46y)' });
    const gridRootC = new El('div', {});
    gridRootC.appendChild(rowCoalesce.master);
    gridRootC.appendChild(rowCoalesce.detail);
    sandbox.document = makeDocument(gridRootC);
    sandbox.queueObservedContainer = gridRootC;
    sandbox._durableRowMap.set(0, rowIdCoalesce);
    sandbox._queueResultCache.set(rowIdCoalesce, { sev: redSev, ts: Date.now() });

    let rafCalls = 0;
    const queuedRaf = [];
    sandbox.requestAnimationFrame = (fn) => {
      rafCalls++;
      queuedRaf.push(fn);
    };
    sandbox.updateQueueStatusBar();
    sandbox.updateQueueStatusBar();
    sandbox.updateQueueStatusBar();
    check(
      rafCalls === 1,
      `three updateQueueStatusBar() calls before a frame runs schedule only ONE rAF (got ${rafCalls})`
    );
    check(
      sandbox.document.getElementById('ch-q-status-bar') === null,
      'nothing rendered yet — the coalesced render is still pending the (stubbed) animation frame'
    );
    queuedRaf.forEach((fn) => fn());
    check(
      !!sandbox.document.getElementById('ch-q-status-bar'),
      'once the frame runs, the coalesced render has happened'
    );
    sandbox.updateQueueStatusBar();
    check(
      rafCalls === 2,
      'after the pending flag is cleared, a further call schedules a new rAF (not swallowed forever)'
    );
    queuedRaf.pop()();
    sandbox.requestAnimationFrame = (fn) => fn(); // restore the synchronous stub for later layers
  }

  // ============================================================
  // Layer 12 — focus-alerts toggle (item 1.2): class on document.body (the
  // stable element, per applyQueueFocusClass's own reasoning), button
  // ARIA/visual state, OFF by default, and the class-composition proof that
  // the dim CSS rule excludes tinted rows (including preview rows).
  // ============================================================
  console.log('\nLayer 12: focus-alerts toggle — body class, button ARIA state, OFF by default, tint-class exclusion');

  {
    freshCaches();
    const rowIdRed = 'c0000000-0000-4000-8000-000000000001';
    const rowIdCalm = 'c0000000-0000-4000-8000-000000000002';
    const rowRed = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdRed, dob: '01 Jan 1980 (46y)' });
    const rowCalm = buildPreviewRowPair({ rowIndex: 1, rowId: rowIdCalm, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    [rowRed, rowCalm].forEach(({ master, detail }) => {
      gridRoot.appendChild(master);
      gridRoot.appendChild(detail);
    });
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;
    sandbox._durableRowMap.set(0, rowIdRed);
    sandbox._queueResultCache.set(rowIdRed, { sev: redSev, ts: Date.now() });
    sandbox.reapplyQueueRowTint(); // rowRed (+ its preview row) now carries ch-row-sev-red; rowCalm carries neither

    sandbox.renderQueueStatusBar();
    const bar = sandbox.document.getElementById('ch-q-status-bar');
    const focusBtn = bar.querySelector('.ch-q-status-focus');
    check(!!focusBtn, 'status bar has a focus-alerts button');
    check(focusBtn.attrs['aria-pressed'] === 'false', 'focus-alerts starts OFF (aria-pressed=false) by default');
    check(
      !sandbox.document.body.classes.includes('ch-q-focus-alerts'),
      'OFF by default: document.body does not carry the focus class yet'
    );

    sandbox.onQueueStatusFocusClick({ currentTarget: focusBtn });
    check(
      sandbox.document.body.classes.includes('ch-q-focus-alerts'),
      'clicking focus-alerts adds the class to document.body — the stable element, not the (re-buildable) grid container'
    );
    check(focusBtn.attrs['aria-pressed'] === 'true', 'button aria-pressed flips to true');
    check(focusBtn.classes.includes('ch-q-status-btn-active'), 'button gets the active visual class');

    // ---- class-composition proof for the dim CSS rule ----
    // `.ch-q-focus-alerts .ag-row:not(.ch-row-sev-red):not(.ch-row-sev-amber)` —
    // assert the class SETS the rule keys off, not computed opacity (per task).
    check(
      rowCalm.master.classes.includes('ag-row') &&
        !rowCalm.master.classes.includes('ch-row-sev-red') &&
        !rowCalm.master.classes.includes('ch-row-sev-amber'),
      'untinted row: carries neither tint class, so the :not()/:not() dim selector MATCHES it (would be dimmed)'
    );
    check(
      rowRed.master.classes.includes('ch-row-sev-red'),
      'red-tinted master row: carries ch-row-sev-red, so :not(.ch-row-sev-red) EXCLUDES it (would NOT be dimmed)'
    );
    check(
      rowRed.detail.classes.includes('ch-row-sev-red'),
      "red-tinted row's own preview/detail row ALSO carries ch-row-sev-red (item 1.3's own tint application) — " +
        'so it is excluded from dimming too, satisfying "a preview row of a red/amber master must NOT be dimmed" ' +
        'with no extra selector needed'
    );

    sandbox.onQueueStatusFocusClick({ currentTarget: focusBtn });
    check(
      !sandbox.document.body.classes.includes('ch-q-focus-alerts'),
      'clicking again removes the class from document.body'
    );
    check(focusBtn.attrs['aria-pressed'] === 'false', 'button aria-pressed flips back to false');
    check(!focusBtn.classes.includes('ch-q-status-btn-active'), 'button loses the active visual class');

    // A brand-new bar element (bar torn down + recreated across a queue re-visit)
    // must reflect the CURRENT toggle state on its own fresh button, not always
    // default to OFF — renderQueueStatusBar syncs this every render.
    sandbox.onQueueStatusFocusClick({ currentTarget: focusBtn }); // toggle back ON
    sandbox.removeQueueStatusBar();
    sandbox.renderQueueStatusBar();
    const bar2 = sandbox.document.getElementById('ch-q-status-bar');
    const focusBtn2 = bar2.querySelector('.ch-q-status-focus');
    check(
      focusBtn2.attrs['aria-pressed'] === 'true',
      'a freshly (re)created bar syncs its focus button to the still-ON session-local toggle state'
    );
    sandbox.onQueueStatusFocusClick({ currentTarget: focusBtn2 }); // leave state OFF for later layers
  }

  // ============================================================
  // Layer 13 — jump-to-next-alert button (item 1.2): scrollIntoView + flash
  // on the right row (and its preview row), ascending cycle order, wrap,
  // jump-cycle reset when the aggregate red/amber picture materially changes,
  // disabled/label state.
  // ============================================================
  console.log(
    '\nLayer 13: jump-to-next-alert — scrollIntoView + flash, ascending cycle, wrap, reset-on-material-change'
  );

  {
    freshCaches();
    const rowIdRedA = 'd0000000-0000-4000-8000-000000000001'; // row-index 0
    const rowIdAmber = 'd0000000-0000-4000-8000-000000000002'; // row-index 1
    const rowIdRedB = 'd0000000-0000-4000-8000-000000000003'; // row-index 2
    const rowRedA = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdRedA, dob: '01 Jan 1980 (46y)' });
    const rowAmber = buildPreviewRowPair({ rowIndex: 1, rowId: rowIdAmber, dob: '01 Jan 1980 (46y)' });
    const rowRedB = buildPreviewRowPair({ rowIndex: 2, rowId: rowIdRedB, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    [rowRedA, rowAmber, rowRedB].forEach(({ master, detail }) => {
      gridRoot.appendChild(master);
      gridRoot.appendChild(detail);
    });
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;
    sandbox._durableRowMap.set(0, rowIdRedA);
    sandbox._durableRowMap.set(1, rowIdAmber);
    sandbox._durableRowMap.set(2, rowIdRedB);
    sandbox._queueResultCache.set(rowIdRedA, { sev: redSev, ts: Date.now() });
    sandbox._queueResultCache.set(rowIdAmber, { sev: amberSev, ts: Date.now() });
    sandbox._queueResultCache.set(rowIdRedB, { sev: redSev, ts: Date.now() });
    sandbox.reapplyQueueRowTint();

    const scrollCalls = { a: [], b: [] };
    rowRedA.master.scrollIntoView = (opts) => scrollCalls.a.push(opts);
    rowRedB.master.scrollIntoView = (opts) => scrollCalls.b.push(opts);

    sandbox.renderQueueStatusBar();
    const jumpBtn = sandbox.document.getElementById('ch-q-status-bar').querySelector('.ch-q-status-jump');
    check(!jumpBtn.disabled, 'reds present: jump button is enabled');
    check(
      jumpBtn.textContent === '▶ red',
      'reds present (even alongside an amber): button reads "▶ red", never mixes lists'
    );

    sandbox.onQueueStatusJumpClick();
    check(scrollCalls.a.length === 1, 'first jump: scrollIntoView called on the first ascending red row (row 0)');
    check(scrollCalls.a[0] && scrollCalls.a[0].block === 'center', 'scrollIntoView called with {block: "center"}');
    check(rowRedA.master.classes.includes('ch-q-status-flash'), 'first jump: the jumped-to row gets the flash class');
    check(
      rowRedA.detail.classes.includes('ch-q-status-flash'),
      "first jump: the row's own preview/detail row ALSO gets the flash class"
    );

    sandbox.onQueueStatusJumpClick();
    check(scrollCalls.b.length === 1, 'second jump: cycles ascending to the NEXT red row (row 2), not back to row 0');
    check(scrollCalls.a.length === 1, 'second jump: row 0 (already visited) is not scrolled to again');

    sandbox.onQueueStatusJumpClick();
    check(scrollCalls.a.length === 2, 'third jump: wraps back around to row 0 (ascending cycle, red-only list)');

    // ---- reset-on-material-change: a new red row changes the aggregate picture ----
    const rowIdRedC = 'd0000000-0000-4000-8000-000000000004';
    const rowRedC = buildPreviewRowPair({ rowIndex: 3, rowId: rowIdRedC, dob: '01 Jan 1980 (46y)' });
    gridRoot.appendChild(rowRedC.master);
    gridRoot.appendChild(rowRedC.detail);
    sandbox._durableRowMap.set(3, rowIdRedC);
    sandbox._queueResultCache.set(rowIdRedC, { sev: redSev, ts: Date.now() });
    sandbox.reapplyQueueRowTint();
    const scrollCallsC = [];
    rowRedC.master.scrollIntoView = (opts) => scrollCallsC.push(opts);

    // Without a render in between, the cycle would simply continue (row 0 was
    // the last jump target -> next ascending red is row 2). Rendering first is
    // what detects the red-count change (3 -> 4) and resets the cycle.
    sandbox.renderQueueStatusBar();
    sandbox.onQueueStatusJumpClick();
    // Without the reset, the cycle would have simply continued from row 0
    // (the last jump target) to the next ascending red, row 2 — incrementing
    // scrollCalls.b instead. The reset lands back on row 0 (scrollCalls.a),
    // proving the material-change detection fired, not a continued cycle.
    check(
      scrollCalls.a.length === 3 && scrollCalls.b.length === 1 && scrollCallsC.length === 0,
      'reset-on-material-change: after the red count grew, the NEXT jump restarts from the first ascending red ' +
        `(row 0 again — a:${scrollCalls.a.length}, b:${scrollCalls.b.length}, c:${scrollCallsC.length}), not a continued cycle`
    );

    // ---- zero alerts: button disabled, safe no-op click ----
    freshCaches();
    const rowIdCalm = 'd0000000-0000-4000-8000-000000000005';
    const rowCalm = buildPreviewRowPair({ rowIndex: 0, rowId: rowIdCalm, dob: '01 Jan 1980 (46y)' });
    const gridRoot2 = new El('div', {});
    gridRoot2.appendChild(rowCalm.master);
    gridRoot2.appendChild(rowCalm.detail);
    sandbox.document = makeDocument(gridRoot2);
    sandbox.queueObservedContainer = gridRoot2;
    sandbox._durableRowMap.set(0, rowIdCalm);
    sandbox._queueResultCache.set(rowIdCalm, { sev: noneSev, ts: Date.now() });
    sandbox.reapplyQueueRowTint();
    sandbox.renderQueueStatusBar();
    const jumpBtn2 = sandbox.document.getElementById('ch-q-status-bar').querySelector('.ch-q-status-jump');
    check(jumpBtn2.disabled, 'no red or amber rows: jump button is disabled');
    let threw = false;
    try {
      sandbox.onQueueStatusJumpClick();
    } catch (e) {
      threw = true;
    }
    check(
      !threw,
      'clicking the (disabled, but content.js does not rely on the DOM disabled attribute alone) jump handler with nothing to jump to is a safe no-op'
    );
    check(!rowCalm.master.classes.includes('ch-q-status-flash'), 'no-op click: the calm row is never flashed');
  }

  // ============================================================
  // Layer 14 — ranked/collapsed rule-match chips + their evidence menu
  // (items 2.1/2.3/2.5, TRIAGE-LENS-2026-07-02.md)
  // ============================================================
  console.log(
    '\nLayer 14: rule-match chips ranked red<amber<info, collapsed to top+"+N", clickable menu with evidence + list-all'
  );

  const RM = require('./content-scripts/triage-lens/rule-match.js');
  function mkRule(id, kind, label, patterns) {
    return RM.compileRule({
      id,
      label,
      kind,
      enabled: true,
      regex: false,
      patterns,
      fields: ['request'],
      pages: ['queue'],
      builtin: true,
      actions: [{ type: 'note', label: 'Clinical note', text: 'n/a' }],
    });
  }
  const ruleRed = mkRule('r-red', 'red', 'Sepsis flag', ['fever']);
  const ruleAmber = mkRule('r-amber', 'amber', 'UTI query', ['waterworks']);
  const ruleInfo = mkRule('r-info', 'info', 'Admin query', ['sick note']);
  const multiRulePreviewText = 'Patient has a fever and waterworks symptoms, also wants a sick note.';

  {
    // ---- pure ranking: red < amber < info regardless of match order ----
    const ranked = sandbox.rankRuleMatches([ruleAmber, ruleInfo, ruleRed]);
    check(
      ranked.map((r) => r.id).join(',') === 'r-red,r-amber,r-info',
      `rankRuleMatches: red < amber < info (got ${ranked.map((r) => r.id).join(',')})`
    );
    // Stable within the same severity: original relative order preserved.
    const ranked2 = sandbox.rankRuleMatches([ruleAmber, ruleRed, ruleInfo, ruleRed]);
    check(
      ranked2[0].id === 'r-red' && ranked2[1].id === 'r-red',
      'rankRuleMatches: ties on severity keep their original relative order (stable sort)'
    );
  }

  {
    // ---- decorateOneRow: multiple matched rules -> top chip + "+N" ----
    freshCaches();
    sandbox.matchRules = () => [ruleAmber, ruleInfo, ruleRed]; // deliberately NOT pre-sorted
    const rowId = 'e0000000-0000-4000-8000-000000000001';
    const { master, detail, wrap } = buildPreviewRowPair({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox.decorateOneRow(master);
    const ruleChips = wrap.querySelectorAll('.ch-q-rule-chip');
    check(
      ruleChips.length === 2,
      `multi-rule row: exactly 2 rule-match chips rendered (top + "+N"), got ${ruleChips.length}`
    );
    const [topChip, overflowChip] = ruleChips;
    check(
      topChip && topChip.classes.includes('ch-chip-red'),
      `top chip is the highest-severity match (red), got classes: ${topChip && topChip.classes.join(' ')}`
    );
    check(topChip.textContent.includes('Sepsis flag'), "top chip shows the top-ranked rule's label");
    check(topChip.getAttribute('data-rq-idx') === '0', 'top chip carries data-rq-idx="0"');
    check(topChip.getAttribute('role') === 'button', 'top chip has role="button" (a11y requirement)');
    check(topChip.getAttribute('tabindex') === '0', 'top chip has tabindex="0" (a11y requirement)');
    check(
      /Sepsis flag.*red alert.*2 more rules matched/.test(topChip.getAttribute('aria-label') || ''),
      `top chip aria-label names the rule, its severity, and the overflow count (got: ${topChip.getAttribute('aria-label')})`
    );
    check(
      overflowChip && overflowChip.classes.includes('ch-chip-meta') && overflowChip.textContent.includes('+2'),
      `overflow chip reads "+2" with the meta (outline) kind, got classes/text: ${overflowChip && overflowChip.classes.join(' ')} / ${overflowChip && overflowChip.textContent}`
    );
    check(
      overflowChip.getAttribute('role') === 'button' && overflowChip.getAttribute('tabindex') === '0',
      'overflow "+N" chip is also role="button" tabindex="0"'
    );
    check(
      !wrap.querySelectorAll('[data-rule-id]').length,
      'rule-match chips do NOT carry data-rule-id (kept distinct from the system-chip [data-rule-id] wiring, no double-handler risk)'
    );

    // ---- end-to-end: an actual click on the RENDERED chip (not a direct
    // showRuleMatchMenu(...) call) drives decorateOneRow's own wiring —
    // dataset.rqIdx lookup -> ruleMatchActivators[idx] -> showRuleMatchMenu —
    // proving the wiring pass itself (not just the menu-building functions
    // in isolation) is correct. ----
    topChip.click();
    const openedMenu = sandbox.document.querySelector('.ch-rule-menu');
    check(!!openedMenu, "clicking the RENDERED top chip opens the rule-match popover via decorateOneRow's own wiring");
    const openedHead = openedMenu && openedMenu.querySelector('.ch-action-menu-head');
    const openedBadge = openedHead && openedHead.querySelector('.ch-chip');
    check(
      openedBadge && openedBadge.textContent === 'Sepsis flag',
      `clicking the top chip opens detail for the TOP rule specifically (got: ${openedBadge && openedBadge.textContent})`
    );
    sandbox.closeActionMenu();

    overflowChip.click();
    const openedListMenu = sandbox.document.querySelector('.ch-rule-menu');
    check(
      openedListMenu && openedListMenu.querySelectorAll('.ch-rule-menu-list-item').length === 3,
      'clicking the RENDERED "+N" chip opens the list-all view with every matched rule, via the real click wiring'
    );
    sandbox.closeActionMenu();
  }

  {
    // ---- decorateOneRow: single matched rule -> top chip only, no "+N" ----
    freshCaches();
    sandbox.matchRules = () => [ruleRed];
    const rowId = 'e0000000-0000-4000-8000-000000000002';
    const { master, detail, wrap } = buildPreviewRowPair({ rowIndex: 0, rowId, dob: '01 Jan 1980 (46y)' });
    const gridRoot = new El('div', {});
    gridRoot.appendChild(master);
    gridRoot.appendChild(detail);
    sandbox.document = makeDocument(gridRoot);
    sandbox.queueObservedContainer = gridRoot;

    sandbox.decorateOneRow(master);
    const ruleChips = wrap.querySelectorAll('.ch-q-rule-chip');
    check(ruleChips.length === 1, `single-rule row: exactly 1 rule-match chip (no overflow), got ${ruleChips.length}`);
    check(
      !/more rule/.test(ruleChips[0].getAttribute('aria-label') || ''),
      'single-rule row: aria-label has no "more rules matched" suffix'
    );
    sandbox.matchRules = () => []; // restore the file's default stub for later scenarios
  }

  {
    // ---- "+N" click opens the list-all view with every matched rule ----
    freshCaches();
    sandbox.document = makeDocument(new El('div', {}));
    const anchor = new El('span');
    sandbox.showRuleMatchMenu(anchor, [ruleRed, ruleAmber, ruleInfo], multiRulePreviewText, true);
    const menu = sandbox.document.querySelector('.ch-rule-menu');
    check(!!menu, 'showRuleMatchMenu(openList=true): a .ch-rule-menu popover was appended to document.body');
    check(menu.getAttribute('role') === 'menu', 'popover has role="menu"');
    const listItems = menu.querySelectorAll('.ch-rule-menu-list-item');
    check(listItems.length === 3, `list view: one row per matched rule (got ${listItems.length})`);
    const labels = listItems.map((i) => i.textContent).join(' | ');
    check(
      labels.includes('Sepsis flag') && labels.includes('UTI query') && labels.includes('Admin query'),
      `list view: every matched rule's label is present (got: ${labels})`
    );
    listItems.forEach((i) => {
      check(i.getAttribute('role') === 'menuitem', 'each list row has role="menuitem"');
      check(i.getAttribute('tabindex') === '0', 'each list row has tabindex 0');
    });

    // Drilling into a list item shows that rule's own detail (evidence +
    // actions) WITH a back button (came from the list). (This fake DOM's
    // selector engine has no descendant combinator — `.a .b` is parsed as
    // "has both classes on ONE element", not "a .b inside .a" — so drill
    // down in two querySelector steps instead of one compound selector.)
    listItems[1].click(); // UTI query
    const detailHead = menu.querySelector('.ch-action-menu-head');
    const detailBadge = detailHead && detailHead.querySelector('.ch-chip');
    check(
      detailBadge && detailBadge.textContent === 'UTI query',
      `clicking a list row drills into ITS OWN rule's detail view (got badge: ${detailBadge && detailBadge.textContent})`
    );
    check(!!menu.querySelector('.ch-action-back'), 'detail view reached FROM the list carries a "Back" control');
    const evidenceText = menu.querySelector('.ch-rule-menu-evidence-text');
    check(
      !!evidenceText && evidenceText.textContent.includes('waterworks'),
      `drilled-into detail view shows evidence for the CLICKED rule (waterworks), got: ${evidenceText && evidenceText.textContent}`
    );
    const evidenceStrong = evidenceText && evidenceText.querySelector('strong');
    check(!!evidenceStrong, 'evidence text highlights the matched term in a <strong> element');
    check(
      evidenceStrong && evidenceStrong.textContent === 'waterworks',
      `the <strong> element wraps exactly the matched term (got "${evidenceStrong && evidenceStrong.textContent}")`
    );

    // Back returns to the list.
    menu.querySelector('.ch-action-back').click();
    check(
      menu.querySelectorAll('.ch-rule-menu-list-item').length === 3,
      'clicking "Back" from a drilled-into detail view returns to the full list'
    );
  }

  {
    // ---- top-chip click opens detail DIRECTLY (no list, no back button) ----
    freshCaches();
    sandbox.document = makeDocument(new El('div', {}));
    const anchor = new El('span');
    sandbox.showRuleMatchMenu(anchor, [ruleRed, ruleAmber], multiRulePreviewText, false);
    const menu = sandbox.document.querySelector('.ch-rule-menu');
    check(
      menu.querySelectorAll('.ch-rule-menu-list-item').length === 0,
      'top-chip open (openList=false): no list view rendered'
    );
    const topHead = menu.querySelector('.ch-action-menu-head');
    const badge = topHead && topHead.querySelector('.ch-chip');
    check(
      badge && badge.textContent === 'Sepsis flag',
      'top-chip open: detail view is for the TOP (highest-severity) rule directly'
    );
    check(!menu.querySelector('.ch-action-back'), 'top-chip open: no back button (nothing to go back to)');
    const evidenceText = menu.querySelector('.ch-rule-menu-evidence-text');
    check(
      !!evidenceText && evidenceText.textContent.includes('fever'),
      `top-chip open: evidence shown for the top rule (fever), got: ${evidenceText && evidenceText.textContent}`
    );
    check(
      menu.querySelectorAll('.ch-action-menu-item').length === 1,
      'detail view lists the rule\'s configured action(s) (one "note" action fixture)'
    );

    // A rule with NO textual match in the given previewText (defensive case —
    // e.g. stale evidence after the request text changed) shows the "no
    // matching text" fallback rather than throwing or showing nothing.
    const ruleNoMatch = mkRule('r-nomatch', 'amber', 'Unrelated rule', ['xyzxyz-never-present']);
    sandbox.showRuleMatchMenu(anchor, [ruleNoMatch], 'completely different text', false);
    const menu2 = sandbox.document.querySelector('.ch-rule-menu');
    check(
      menu2.querySelector('.ch-rule-menu-evidence-empty') &&
        /no matching text/i.test(menu2.querySelector('.ch-rule-menu-evidence-empty').textContent),
      'no-match case: shows the "no matching text found" fallback instead of throwing'
    );
  }

  {
    // ---- evidence-line-uses-textContent: source-level guard that the
    // request-text evidence path never builds via innerHTML (a prior
    // attribute-injection XSS was fixed in this area; the request text is
    // patient/reception-typed and untrusted). Grep-level assert per the
    // TRIAGE-LENS-2026-07-02.md plan's explicit allowance for this check. ----
    const buildEvidenceElSrc = (src.match(/const buildEvidenceEl = \(rule, previewText\) => \{[\s\S]*?\n {2}\};/) || [
      '',
    ])[0];
    check(buildEvidenceElSrc.length > 0, 'buildEvidenceEl source located for the innerHTML guard');
    check(
      !/\.innerHTML/.test(buildEvidenceElSrc),
      'buildEvidenceEl never assigns .innerHTML — evidence text is built with createElement/textContent/createTextNode only'
    );
    check(
      /createTextNode|\.textContent\s*=/.test(buildEvidenceElSrc),
      'buildEvidenceEl does use textContent/createTextNode to place the (untrusted) request-derived text'
    );
  }
} else {
  console.error('\nSandbox extraction failed — skipping all behavioural layers.');
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
