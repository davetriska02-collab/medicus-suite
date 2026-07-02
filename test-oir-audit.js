// Medicus Suite — OIR auto-tick audit/undo/pref tests (Phase 1.4)
// Run with: node test-oir-audit.js
//
// content-scripts/triage-lens/content.js is a Prettier-excluded, non-module
// monolith (see CLAUDE.md), so — same pattern as test-result-triage-queue.js
// and test-monitoring-chip.js — the functions under test are extracted from
// the real source by exact string anchors and evaluated in a fresh vm
// context with minimal browser/chrome stubs, rather than reimplemented here.
//
// Covers the gap flagged in docs/plans/TRIAGE-LENS-2026-07-02.md item 1.4:
// the OIR auto-tick (applyOutstandingMatch, ~content.js:2583-2590 pre-fix)
// had NO confirmation, NO undo, and NO audit entry. The fix extracted the
// auto-tick + review/undo logic into two standalone functions
// (performOirAutoTick, performOirAutoReview) precisely so this file could
// test them without driving the whole match pipeline.

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

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// Extract the self-contained block: recordOirAudit → the toast helpers →
// performOirAutoTick. Bounded by two exact, unique anchor strings rather than
// a brace-matching regex, so the extraction fails loudly (empty block) if the
// source is restructured, instead of silently grabbing the wrong span.
const START = 'const recordOirAudit = (verdicts, taskUuid, kind) => {';
const END = '\n  // Read the outstanding-request rows from the card.';
const startIdx = src.indexOf(START);
const endIdx = startIdx >= 0 ? src.indexOf(END, startIdx) : -1;
check(startIdx >= 0, 'recordOirAudit start anchor found in content.js');
check(endIdx > startIdx, 'block end anchor found after start');

const block = startIdx >= 0 && endIdx > startIdx ? src.slice(startIdx, endIdx) : '';

// ── minimal fake DOM ──────────────────────────────────────────────────────────
function makeEl(tag) {
  return {
    tag: tag || 'div',
    className: '',
    textContent: '',
    type: null,
    style: {},
    classList: {
      _set: new Set(),
      add(c) {
        this._set.add(c);
      },
      remove(c) {
        this._set.delete(c);
      },
      has(c) {
        return this._set.has(c);
      },
    },
    children: [],
    parentElement: null,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    remove() {
      this.parentElement = null;
    },
    scrollIntoView() {},
    closest() {
      return this;
    },
  };
}
function findByClass(el, cls) {
  if (!el) return null;
  if (el.className === cls) return el;
  for (const c of el.children || []) {
    const found = findByClass(c, cls);
    if (found) return found;
  }
  return null;
}

// ── fake chrome.storage.local ─────────────────────────────────────────────────
let STORE = {};
const chromeStub = {
  storage: {
    local: {
      get(key, cb) {
        const out = {};
        out[key] = STORE[key];
        cb(out);
      },
      set(obj) {
        Object.assign(STORE, obj);
      },
    },
  },
};

// ── PREF stub — mutable per-test override map, else falls back to dflt ────────
let PREFS = {};
function PREF(k, dflt) {
  return Object.prototype.hasOwnProperty.call(PREFS, k) ? PREFS[k] : dflt;
}

// ── spies ──────────────────────────────────────────────────────────────────────
let tickRowsCalls = [];
function tickRows(boxes) {
  tickRowsCalls.push(boxes);
}
let logs = [];
function log(...args) {
  logs.push(args);
}

function reset() {
  STORE = {};
  PREFS = {};
  tickRowsCalls = [];
  logs = [];
}

// ── sandbox ────────────────────────────────────────────────────────────────────
const documentStub = {
  createElement: (tag) => makeEl(tag),
  body: makeEl('body'),
};

const sandbox = {
  chrome: chromeStub,
  document: documentStub,
  requestAnimationFrame: (fn) => fn(),
  setTimeout,
  clearTimeout,
  console,
  PREF,
  tickRows,
  log,
  _oirPatientCache: new Map(),
};

vm.runInNewContext(
  block +
    '\nthis.recordOirAudit = recordOirAudit;' +
    '\nthis.performOirAutoTick = performOirAutoTick;' +
    '\nthis.performOirAutoReview = performOirAutoReview;',
  sandbox
);

const { recordOirAudit, performOirAutoTick, performOirAutoReview } = sandbox;
check(typeof recordOirAudit === 'function', 'recordOirAudit extracted and callable');
check(typeof performOirAutoTick === 'function', 'performOirAutoTick extracted and callable');
check(typeof performOirAutoReview === 'function', 'performOirAutoReview extracted and callable');

// ============================================================
// 1. recordOirAudit — kind field
// ============================================================
console.log('recordOirAudit:');
reset();
const verdictA = { name: 'Full Blood Count', key: 'fbc', matchedValue: '4.2', matchedUnit: '10^9/L' };
recordOirAudit([verdictA], 'task-1', 'auto');
let arr = STORE['triagelens.oir.auditLog'];
check(Array.isArray(arr) && arr.length === 1, 'auto entry written');
check(arr[0].kind === 'auto', `kind is 'auto' (got ${arr[0] && arr[0].kind})`);
check(arr[0].taskUuid === 'task-1', 'taskUuid recorded');
check(arr[0].count === 1 && arr[0].items[0].name === 'Full Blood Count', 'item detail recorded');

reset();
recordOirAudit([verdictA], 'task-2'); // kind omitted
arr = STORE['triagelens.oir.auditLog'];
check(arr[0].kind === 'bulk', `omitted kind defaults to 'bulk' for back-compat (got ${arr[0] && arr[0].kind})`);

reset();
recordOirAudit([verdictA], 'task-3', 'auto-review');
arr = STORE['triagelens.oir.auditLog'];
check(arr[0].kind === 'auto-review', `kind 'auto-review' recorded (got ${arr[0] && arr[0].kind})`);

reset();
recordOirAudit([verdictA], 'task-4', 'bulk');
recordOirAudit([verdictA], 'task-5', 'auto');
arr = STORE['triagelens.oir.auditLog'];
check(arr.length === 2 && arr[0].taskUuid === 'task-5' && arr[1].taskUuid === 'task-4', 'newest-first ring buffer');

// ============================================================
// 2. performOirAutoTick — pref ON (default): ticks + audits + toasts
// ============================================================
console.log('performOirAutoTick (oirAutoTick default ON):');
reset();
const box1 = makeEl('input');
const rows = { 0: { box: box1 } };
const verdicts = [
  { id: 0, name: 'Full Blood Count', autoTick: true },
  { id: 1, autoTick: false },
];
performOirAutoTick(verdicts, rows, 'task-auto-1');
check(
  tickRowsCalls.length === 1 && tickRowsCalls[0].length === 1 && tickRowsCalls[0][0] === box1,
  'tickRows called with the one autoTick box'
);
arr = STORE['triagelens.oir.auditLog'];
check(Array.isArray(arr) && arr.length === 1 && arr[0].kind === 'auto', 'audit entry written with kind auto');
check(arr[0].items[0].name === 'Full Blood Count', 'audited item is the ticked verdict');
const toastEl = findByClass(documentStub.body, 'ch-oir-toast');
check(!!toastEl, 'auto-tick toast injected into document.body');
const toastMsg = toastEl && findByClass(toastEl, 'ch-oir-toast-msg');
check(
  !!toastMsg && /Full Blood Count/.test(toastMsg.textContent),
  `toast lists the auto-ticked name (${toastMsg && toastMsg.textContent})`
);
const reviewBtn = toastEl && findByClass(toastEl, 'ch-oir-toast-btn');
check(
  !!reviewBtn && reviewBtn.textContent === 'Review',
  'toast has a Review action (not a fake "Undo" — see performOirAutoReview)'
);
check(typeof (reviewBtn && reviewBtn.onclick) === 'function', 'Review button has a click handler wired');

// ============================================================
// 3. performOirAutoTick — pref OFF: never ticks, never audits
// ============================================================
console.log('performOirAutoTick (oirAutoTick = false):');
reset();
PREFS.oirAutoTick = false;
documentStub.body = makeEl('body');
performOirAutoTick(verdicts, rows, 'task-auto-2');
check(tickRowsCalls.length === 0, 'tickRows NOT called when oirAutoTick pref is off');
check(STORE['triagelens.oir.auditLog'] === undefined, 'no audit entry written when oirAutoTick pref is off');
check(!findByClass(documentStub.body, 'ch-oir-toast'), 'no toast shown when oirAutoTick pref is off');

// ============================================================
// 4. performOirAutoTick — no eligible verdicts is a silent no-op
// ============================================================
console.log('performOirAutoTick (nothing eligible):');
reset();
documentStub.body = makeEl('body');
performOirAutoTick([{ id: 0, autoTick: false }], rows, 'task-auto-3');
check(tickRowsCalls.length === 0, 'tickRows NOT called when no verdict has autoTick');
check(STORE['triagelens.oir.auditLog'] === undefined, 'no audit entry when nothing was ticked');

// ============================================================
// 5. performOirAutoTick — oirAuditLog pref off still ticks, but does not audit
// ============================================================
console.log('performOirAutoTick (oirAuditLog = false):');
reset();
PREFS.oirAuditLog = false;
documentStub.body = makeEl('body');
performOirAutoTick(verdicts, rows, 'task-auto-4');
check(tickRowsCalls.length === 1, 'tick still happens with oirAuditLog off');
check(STORE['triagelens.oir.auditLog'] === undefined, 'no audit entry written when oirAuditLog pref is off');

// ============================================================
// 6. performOirAutoReview — "Undo" is honest: flashes rows + records
//    kind:'auto-review', never re-clicks the checkbox (see content.js comment:
//    ticking writes to Medicus immediately and can't be undone from here).
// ============================================================
console.log('performOirAutoReview:');
reset();
let clicked = false;
const reviewBox = makeEl('input');
reviewBox.click = () => {
  clicked = true;
};
performOirAutoReview([verdictA], [reviewBox], 'task-review-1');
check(clicked === false, 'performOirAutoReview never re-clicks the checkbox (no fake undo)');
check(reviewBox.classList.has('ch-oir-flash'), 'the reviewed row is flashed (ch-oir-flash class added)');
arr = STORE['triagelens.oir.auditLog'];
check(
  Array.isArray(arr) && arr.length === 1 && arr[0].kind === 'auto-review',
  'review action recorded as kind auto-review'
);
check(arr[0].taskUuid === 'task-review-1', 'review audit entry carries the taskUuid');

reset();
PREFS.oirAuditLog = false;
performOirAutoReview([verdictA], [makeEl('input')], 'task-review-2');
check(STORE['triagelens.oir.auditLog'] === undefined, 'review does not audit when oirAuditLog pref is off');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
