// Medicus Suite — Sentinel side-panel state tests
// Run with: node test-sentinel-panel-state.js
//
// vm-extracts the pure classifySnapshot(snapshot) helper from
// side-panel/modules/sentinel/sentinel.js and asserts the side panel surfaces a
// degraded extraction and an invalidated (stale) snapshot as something OTHER
// than the benign "no chips" all-clear (H-005 / wrong-patient guard). Same
// Layer-2 pattern as test-extraction-health.js.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'sentinel', 'sentinel.js'), 'utf8');
const m = src.match(/function classifySnapshot\(snapshot\) \{[\s\S]*?\n\}/);
check(!!m, 'classifySnapshot extracted from side-panel sentinel module');

let classify = null;
if (m) {
  const sandbox = {};
  vm.runInNewContext(m[0] + '\nthis.classifySnapshot = classifySnapshot;', sandbox);
  classify = sandbox.classifySnapshot;
  check(typeof classify === 'function', 'helper is callable');
}

console.log('\n--- must NOT read as a benign all-clear ---');
check(classify({ degraded: true, chips: [], patientContext: { patientName: 'Smith, John' } }) === 'degraded',
  'degraded extraction (patient identified, nothing extracted) → degraded, not data');
check(classify({ unavailable: true, chips: null }) === 'unavailable',
  'invalidated snapshot (navigating / failed extraction) → unavailable, not data');
check(classify({ degraded: true, unavailable: true, chips: null }) === 'unavailable',
  'an invalidated snapshot is never treated as real data even if degraded is set');

console.log('\n--- genuine states ---');
check(classify({ chips: [{ status: 'overdue' }], patientContext: {} }) === 'data',
  'real chips → data');
check(classify({ chips: [], degraded: false }) === 'data',
  'genuinely empty (extraction healthy, no matched rules) → data (panel shows "no chips")');
check(classify({ chips: [{ status: 'overdue' }], degraded: false, modules: { medications: 3, observations: 0, problems: 1, demographics: true } }) === 'data',
  'per-module breakdown on a healthy snapshot does not change classification (informational only, not an alarm)');
check(classify({ degraded: true, chips: [], modules: { medications: 0, observations: 0, problems: 0, demographics: false } }) === 'degraded',
  'a degraded snapshot is still degraded even though it now also carries a (zeroed) modules breakdown');
check(classify({ chips: null }) === 'no-chips', 'no snapshot chips yet → no-chips');
check(classify(null) === 'no-chips', 'null snapshot → no-chips (no crash)');
check(classify(undefined) === 'no-chips', 'undefined snapshot → no-chips (no crash)');

// ── buildAuditHeadline: the per-patient audit headline counts ──────────────────
// Pure helper that derives the "N meds checked · M matched · K overdue · P
// unmatched" headline from the already-computed render values. Asserts it
// reuses the existing fields (modules.medications, drug-monitoring chips,
// unmatchedMeds) and degrades to null when there is nothing to summarise.
const hm = src.match(/function buildAuditHeadline\(\{[\s\S]*?\n\}/);
check(!!hm, 'buildAuditHeadline extracted from side-panel sentinel module');

let headline = null;
if (hm) {
  const sandbox = {};
  // buildAuditHeadline reads the module-level STATUS_RANK constant; provide a
  // matching copy in the sandbox so the overdue tally resolves.
  const rankSrc =
    'const STATUS_RANK = { overdue: 0, not_met: 0, alert: 0, stale: 1, due_soon: 2, caution: 2, no_data: 3, noted: 3, recently_initiated: 4, achieved: 5, in_date: 5 };\n';
  vm.runInNewContext(rankSrc + hm[0] + '\nthis.buildAuditHeadline = buildAuditHeadline;', sandbox);
  headline = sandbox.buildAuditHeadline;
  check(typeof headline === 'function', 'buildAuditHeadline is callable');
}

if (headline) {
  console.log('\n--- buildAuditHeadline counts ---');

  const h1 = headline({
    chips: [
      { type: 'drug-monitoring', status: 'in_date' },
      { type: 'drug-monitoring', status: 'overdue' },
      { type: 'qof-indicator', status: 'not_met' },
    ],
    modules: { medications: 6 },
    unmatchedMeds: ['BrandX', 'BrandY'],
  });
  check(h1 && h1.medsChecked === 6, 'medsChecked reuses modules.medications');
  check(h1 && h1.matched === 2, 'matched counts only drug-monitoring chips (QOF excluded)');
  check(h1 && h1.overdue === 1, 'overdue counts only action-needed (rank<=2) monitoring chips');
  check(h1 && h1.unmatched === 2, 'unmatched reuses unmatchedMeds.length');

  // The whole point of the finding: a clean, all-in-date record still produces a
  // headline so the screen reads "checked and clear", not "nothing fired".
  const clear = headline({
    chips: [{ type: 'drug-monitoring', status: 'in_date' }],
    modules: { medications: 3 },
    unmatchedMeds: [],
  });
  check(clear && clear.medsChecked === 3 && clear.matched === 1 && clear.overdue === 0 && clear.unmatched === 0,
    'an all-in-date record still yields a headline (verified-clear, not silent)');

  // due_soon / stale also count as overdue (action-needed) in the headline.
  const soon = headline({
    chips: [
      { type: 'drug-monitoring', status: 'due_soon' },
      { type: 'drug-monitoring', status: 'stale' },
    ],
    modules: { medications: 2 },
    unmatchedMeds: [],
  });
  check(soon && soon.overdue === 2, 'due_soon and severely-overdue (stale) both count as overdue');

  // Nothing to summarise → null (headline simply does not render).
  check(headline({ chips: [], modules: null, unmatchedMeds: [] }) === null,
    'no meds, no monitoring chips, no unmatched → null (no headline)');
  check(headline({ chips: [], modules: { medications: 0 }, unmatchedMeds: [] }) !== null,
    'a record with 0 meds extracted still gets a headline (0 meds checked is informative)');

  // Robust to missing / malformed inputs (never throws).
  check(headline({}) === null, 'empty context → null (no crash)');
  check(headline({ chips: null, modules: undefined, unmatchedMeds: null }) === null,
    'null/undefined fields → null (no crash)');
}

// ── task-slot patient-switch: "Task created for X" must not ride onto Y ─────
// #sentTaskSlot lives on the persistent scaffold (outside #sentDynamic), so
// a success banner / open form naming the previous patient used to survive
// the next record load. The slot is stamped with the patient it was opened
// for; syncTaskSlotToPatient (called from render()) clears a confirmation —
// or replaces an OPEN form with a persistent "nothing was created" notice —
// when a DIFFERENT patient's data renders. Leaving the record (idle/queue)
// deliberately keeps the slot: the banner names its own patient, and a GP
// flicking to another tab and back must not lose the confirmation.

const pidFn = src.match(/function patientIdFromContext\(patient\) \{[\s\S]*?\n\}/);
check(!!pidFn, 'patientIdFromContext extracted from side-panel sentinel module');
const clearFn = src.match(/function taskSlotShouldClearOnPatientChange\(slotPatientId, nextPatientId\) \{[\s\S]*?\n\}/);
check(!!clearFn, 'taskSlotShouldClearOnPatientChange extracted from side-panel sentinel module');
const wipeFn = src.match(/function clearSentinelTaskSlot\(slot\) \{[\s\S]*?\n\}/);
check(!!wipeFn, 'clearSentinelTaskSlot extracted from side-panel sentinel module');
const noticeFn = src.match(/function taskSlotCancelledNoticeHtml\(patientName\) \{[\s\S]*?\n\}/);
check(!!noticeFn, 'taskSlotCancelledNoticeHtml extracted from side-panel sentinel module');

let patientIdFromContext = null;
let taskSlotShouldClearOnPatientChange = null;
let clearSentinelTaskSlot = null;
let taskSlotCancelledNoticeHtml = null;
if (pidFn && clearFn && wipeFn && noticeFn) {
  const sandbox = {};
  const escSrc =
    "const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');\n";
  vm.runInNewContext(
    escSrc + pidFn[0] + '\n' + clearFn[0] + '\n' + wipeFn[0] + '\n' + noticeFn[0] +
      '\nthis.patientIdFromContext = patientIdFromContext;' +
      '\nthis.taskSlotShouldClearOnPatientChange = taskSlotShouldClearOnPatientChange;' +
      '\nthis.clearSentinelTaskSlot = clearSentinelTaskSlot;' +
      '\nthis.taskSlotCancelledNoticeHtml = taskSlotCancelledNoticeHtml;',
    sandbox
  );
  patientIdFromContext = sandbox.patientIdFromContext;
  taskSlotShouldClearOnPatientChange = sandbox.taskSlotShouldClearOnPatientChange;
  clearSentinelTaskSlot = sandbox.clearSentinelTaskSlot;
  taskSlotCancelledNoticeHtml = sandbox.taskSlotCancelledNoticeHtml;
}

console.log('\n--- patientIdFromContext ---');
if (patientIdFromContext) {
  check(patientIdFromContext({ patientUuid: 'aaa' }) === 'aaa', 'reads patientUuid');
  check(patientIdFromContext({ uuid: 'bbb' }) === 'bbb', 'falls back to uuid');
  check(patientIdFromContext({ patientUuid: 'aaa', uuid: 'bbb' }) === 'aaa', 'patientUuid wins over uuid');
  check(patientIdFromContext({ patientName: 'Mr Dolly Smith' }) === '', 'a name alone is never an id');
  check(patientIdFromContext(null) === '', 'null patient → empty, never throws');
  check(patientIdFromContext(undefined) === '', 'undefined patient → empty, never throws');
}

console.log('\n--- taskSlotShouldClearOnPatientChange ---');
if (taskSlotShouldClearOnPatientChange) {
  check(
    taskSlotShouldClearOnPatientChange('patient-a', 'patient-b') === true,
    'Dolly → next patient: clear the leftover "Task created for Dolly" banner'
  );
  check(
    taskSlotShouldClearOnPatientChange('patient-a', 'patient-a') === false,
    'same-patient 10s poll: keep the confirmation'
  );
  check(
    taskSlotShouldClearOnPatientChange('patient-a', '') === false,
    'left the record (idle / queue / other browser tab): KEEP — banner names its own patient, and flicking away must not lose it'
  );
  check(
    taskSlotShouldClearOnPatientChange('', 'patient-b') === false,
    'un-stamped slot: nothing owned, nothing to clear'
  );
  check(taskSlotShouldClearOnPatientChange('', '') === false, 'idle → idle: nothing to clear');
  check(
    taskSlotShouldClearOnPatientChange(null, 'patient-b') === false,
    'null stamp → false, never throws'
  );
  check(
    taskSlotShouldClearOnPatientChange('patient-a', null) === false,
    'null next (no patientContext on this state) → keep, never throws'
  );
}

console.log('\n--- clearSentinelTaskSlot ---');
if (clearSentinelTaskSlot) {
  const slot = {
    innerHTML: '<div class="sent-task-done">Task created for Mr Dolly Smith.</div>',
    dataset: { open: 'done', patientId: 'patient-a', patientName: 'Mr Dolly Smith' },
  };
  clearSentinelTaskSlot(slot);
  check(slot.innerHTML === '', 'wipes the leftover banner HTML');
  check(slot.dataset.open === '', 'resets dataset.open so the next Create task is a fresh form');
  check(!slot.dataset.patientId && !slot.dataset.patientName, 'removes the ownership stamp');
  clearSentinelTaskSlot(null);
  check(true, 'null slot → no throw');
}

console.log('\n--- taskSlotCancelledNoticeHtml: an open form is never silently vanished ---');
if (taskSlotCancelledNoticeHtml) {
  const html = taskSlotCancelledNoticeHtml('Mr Dolly Smith');
  check(/Nothing was created/.test(html), 'states the consequence — the GP must not believe the task went in');
  check(/Mr Dolly Smith/.test(html), 'names the patient the form belonged to');
  check(/Dismiss/.test(html), 'carries a dismiss action (no timeout — the notice must not expire on its own)');
  const xss = taskSlotCancelledNoticeHtml('<img src=x onerror=alert(1)>');
  check(!/<img/.test(xss), 'patient name is HTML-escaped');
}

console.log('\n--- wiring: render() syncs the slot on every patient-bearing state ---');
{
  check(/syncTaskSlotToPatient\(\s*container\.querySelector\('#sentTaskSlot'\),/.test(src),
    'render() syncs #sentTaskSlot against the patient now on screen');
  check(/patientIdFromContext\(snapshot && snapshot\.patientContext\)/.test(src),
    'the comparison uses the snapshot patientContext (data AND degraded both carry one)');
  check(/slot\.dataset\.patientId = patientId;[\s\S]{0,400}slot\.dataset\.patientName = patientName;/.test(src),
    'the slot is stamped with its owner when a form opens');
  check((src.match(/slot\.dataset\.patientId = patientId;/g) || []).length >= 2,
    'BOTH the create-task form and the follow-up form stamp ownership');
  check(/dataset\.open === '1'[\s\S]{0,200}taskSlotCancelledNoticeHtml/.test(src),
    'an OPEN form is replaced by the cancelled notice, not silently wiped'
  );
  check(/#sentTaskSlot/.test(src) && /sent-task-done/.test(src),
    'the success banner still exists — we clear it on switch, we do not remove the confirmation');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
