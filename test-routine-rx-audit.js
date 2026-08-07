// Medicus Suite — Routine-prescription macro audit tests (Phase 1.4)
// Run with: node test-routine-rx-macro.js
//
// content-scripts/triage-lens/routine-rx-button.js drives the real Medicus UI
// asynchronously (typed keystrokes, debounced pickers, timed waits — see its
// file header and H-035 in docs/HAZARD-LOG.md), so a full end-to-end drive of
// runMacro() is out of scope here. Instead — mirroring test-lab-file-macro.js's
// "exercise the already-isolated safety-relevant helper against a fake DOM"
// style — this tests the AUDIT gap fix in isolation: recordAudit() and its two
// small, side-effect-isolated callers (commitAndAudit / highlightAndAudit /
// abort), exported via the file's own Node test hook (mirrors
// lab-file-button.js's `module.exports` hook).
//
// Covers: (a) a successful 'auto'-mode commit records an audit entry with
// outcome 'committed' (item 4's gap: 'auto' commit previously left no trail);
// (b) an aborted macro records outcome 'aborted' with the reason; (c) 'manual'
// mode records 'highlighted'; (d) the shared Event Ledger mirror carries the
// schema-compliant subset; (e) the ring buffer is capped at 200, newest-first.

'use strict';

// ── fake globals the module needs at require-time ──────────────────────────────
// (routine-rx-button.js is a plain IIFE, not parameterised like
// lab-file-button.js's fileAllNormal — its Node hook returns early, before the
// chrome-storage config load + DOM/observer boot, so only `window`/`document`/
// `chrome`/`location` need to exist, not behave like a full browser.)
let STORE = {};
const ledgerEvents = [];

global.window = {
  EventLedger: {
    record(evt) {
      ledgerEvents.push(evt);
    },
  },
};
global.document = {
  createElement() {
    return {
      className: '',
      textContent: '',
      classList: { add() {}, remove() {} },
      remove() {},
    };
  },
  body: { appendChild() {} },
};
global.chrome = {
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
global.location = {
  pathname: '/tasks/data/prescription-requests/overview/task-uuid-123',
  href: 'https://medicus.example/tasks/data/prescription-requests/overview/task-uuid-123',
};

const {
  recordAudit,
  abort,
  commitAndAudit,
  highlightAndAudit,
  AUDIT_KEY,
} = require('./content-scripts/triage-lens/routine-rx-button.js');

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

function reset() {
  STORE = {};
  ledgerEvents.length = 0;
}

check(AUDIT_KEY === 'triagelens.routinerx.auditLog', `AUDIT_KEY is the documented storage key (got ${AUDIT_KEY})`);

// ============================================================
// 1. Successful 'auto'-mode commit → outcome 'committed' (the item-4 gap)
// ============================================================
console.log("commitAndAudit ('auto' mode) — the previously-untracked commit:");
reset();
let clicked = false;
const commitEl = { click: () => (clicked = true) };
commitAndAudit(commitEl, 'Prescribing / Meds Management', 'auto');
check(clicked, 'the commit control was actually clicked');
let arr = STORE[AUDIT_KEY];
check(Array.isArray(arr) && arr.length === 1, 'one audit entry written');
check(arr[0].outcome === 'committed', `outcome is 'committed' (got ${arr[0] && arr[0].outcome})`);
check(arr[0].commitMode === 'auto', "commitMode 'auto' recorded");
check(arr[0].team === 'Prescribing / Meds Management', 'team recorded');
check(arr[0].taskUrl === global.location.href, 'task URL recorded');
check(arr[0].taskUuid === 'task-uuid-123', `taskUuid parsed from the overview URL (got ${arr[0] && arr[0].taskUuid})`);
check(arr[0].reason === null, 'no reason on a successful commit');
check(ledgerEvents.length === 1, 'mirrored into the Event Ledger');
check(
  ledgerEvents[0].source === 'routinerx' &&
    ledgerEvents[0].action === 'committed' &&
    ledgerEvents[0].label === 'Prescribing / Meds Management',
  'Event Ledger mirror carries source/action/label'
);
check(
  ledgerEvents[0].patientRef === null && ledgerEvents[0].severity === null && ledgerEvents[0].ruleId === null,
  'Event Ledger mirror has no patient identity fields (button makes no network calls — see file header)'
);

// 'confirm' mode, accepted, also reaches commitAndAudit → 'committed'.
reset();
commitAndAudit({ click: () => {} }, 'Duty Doctor', 'confirm');
check(
  STORE[AUDIT_KEY][0].outcome === 'committed' && STORE[AUDIT_KEY][0].commitMode === 'confirm',
  'an accepted confirm-mode commit also records committed'
);

// ============================================================
// 2. Aborted macro → outcome 'aborted' + reason
// ============================================================
console.log('abort() — a macro that could not complete:');
reset();
abort('Couldn’t find the “Assign to” picker. Is this a prescription task?', 'Prescribing / Meds Management', 'confirm');
arr = STORE[AUDIT_KEY];
check(Array.isArray(arr) && arr.length === 1, 'one audit entry written on abort');
check(arr[0].outcome === 'aborted', `outcome is 'aborted' (got ${arr[0] && arr[0].outcome})`);
check(
  arr[0].reason === 'Couldn’t find the “Assign to” picker. Is this a prescription task?',
  'the abort reason is recorded verbatim'
);
check(ledgerEvents.length === 1 && ledgerEvents[0].action === 'aborted', 'aborted mirrored into the Event Ledger');

// A declined confirm-mode dialog is also an 'aborted' outcome with its own reason.
reset();
abort('clinician declined the confirm-mode dialog', 'Prescribing / Meds Management', 'confirm');
check(
  STORE[AUDIT_KEY][0].outcome === 'aborted' &&
    STORE[AUDIT_KEY][0].reason === 'clinician declined the confirm-mode dialog',
  'a declined confirm dialog records aborted with that reason'
);

// ============================================================
// 3. 'manual' mode → outcome 'highlighted' (pre-fill only, never auto-clicks)
// ============================================================
console.log("highlightAndAudit ('manual' mode):");
reset();
let manualClicked = false;
highlightAndAudit({ click: () => (manualClicked = true) }, 'Prescribing / Meds Management', 'manual');
check(manualClicked === false, 'manual mode never clicks the commit control itself');
arr = STORE[AUDIT_KEY];
check(arr[0].outcome === 'highlighted', `outcome is 'highlighted' (got ${arr[0] && arr[0].outcome})`);
check(arr[0].commitMode === 'manual', "commitMode 'manual' recorded");

// ============================================================
// 4. Ring buffer — capped at 200, newest-first (mirrors labfiling.auditLog /
//    triagelens.oir.auditLog's cap convention)
// ============================================================
console.log('ring buffer cap:');
reset();
for (let i = 0; i < 205; i++) {
  recordAudit('Team ' + i, 'auto', 'committed', null);
}
arr = STORE[AUDIT_KEY];
check(arr.length === 200, `ring buffer capped at 200 (got ${arr.length})`);
check(arr[0].team === 'Team 204', 'newest entry is first');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
