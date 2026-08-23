// Queue pulse composer — named-signal compression (not a score).
// Run with: node test-queue-pulse.js
'use strict';

const fs = require('fs');
const path = require('path');
const { composePulse, isContextOnly } = require('./content-scripts/triage-lens/queue-pulse.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const rule = (kind, name) => ({ kind, name, family: 'rule', source: 'request' });
const mon = (kind, name) => ({ kind, name, family: 'monitoring', silent: true });
const pending = (kind, name) => ({ kind, name, family: 'pending', silent: true });
const age = (name) => ({ kind: 'amber', name, family: 'age', source: 'dob' });
const pf = () => ({ kind: 'green', name: 'Pharmacy First', family: 'pf' });
const ask = () => ({ kind: 'info', name: 'Ask-back', family: 'askback' });
const repeat = (name) => ({ kind: 'amber', name, family: 'repeat' });

console.log('Layer 1: composePulse ranking');

{
  const p = composePulse([age('Child · 7y'), rule('red', 'MH crisis'), repeat('2nd contact · 6d')]);
  check(p.rail === 'red', 'rail is red when a request-text red exists');
  check(p.headline && p.headline.name === 'MH crisis', 'headline names the red rule, not age or thread');
  check(p.overflowCount === 2, 'age + thread sit in overflow, not dropped');
  check(p.silent === false, 'request-text headline is not marked silent');
}

{
  const p = composePulse([mon('red', 'MTX · FBC overdue'), age('Elder · 72y')]);
  check(p.rail === 'red', 'record-only red still owns the rail');
  check(p.headline && p.headline.name === 'MTX · FBC overdue', 'silent monitoring can be the headline');
  check(p.silent === true, 'diamond: headline came from the record');
}

{
  const p = composePulse([rule('red', 'Chest pain'), mon('red', 'MTX · FBC overdue')]);
  check(p.headline && p.headline.family === 'rule', 'same-kind: request-text preferred over record');
  check(p.silent === false, 'preferred request-text headline is not silent');
}

{
  const p = composePulse([pf(), ask(), age('34y')]);
  check(p.rail === 'empty', 'Pharmacy First / age do not raise the rail');
  check(p.headline && p.headline.name === 'Ask-back', 'ask-back may headline when nothing clinical-worse fired');
}

{
  const p = composePulse([repeat('4th contact · 10d'), pf()]);
  check(p.rail === 'empty', 'thread count alone does not raise the rail');
  check(p.headline === null, 'thread count is not a headline');
  check(p.thread && p.thread.name === '4th contact · 10d', 'thread is still returned for the mark');
}

{
  const p = composePulse([rule('amber', 'UTI words'), rule('red', 'Chest pain')]);
  check(p.headline.name === 'Chest pain', 'red outranks amber');
  check(p.rail === 'red', 'rail follows worst clinical kind');
}

{
  const p = composePulse([]);
  check(p.rail === 'empty', 'no signals → empty rail (not green, not a score)');
  check(p.headline === null, 'no signals → no headline');
}

{
  const p = composePulse([rule('red', 'MH crisis')], { recordChecked: false });
  check(p.rail === 'unchecked', 'recordChecked:false forces dashed rail even if a red exists');
}

{
  const p = composePulse(null);
  check(p.rail === 'empty' && p.signals.length === 0, 'null input fails closed to empty');
}

console.log('\nLayer 2: isContextOnly');
check(isContextOnly(age('Child')), 'age is context');
check(isContextOnly(pf()), 'Pharmacy First is context');
check(isContextOnly(repeat('3rd')), 'repeat-contact is context');
check(!isContextOnly(rule('red', 'MH crisis')), 'request rule is clinical');
check(!isContextOnly(mon('red', 'MTX')), 'monitoring is clinical (may own rail)');
check(!isContextOnly(pending('red', 'Pending K')), 'pending result is clinical');
check(!isContextOnly(ask()), 'ask-back is not context — it can headline');
check(isContextOnly({ kind: 'meta', name: '+2', family: 'rule' }), 'meta overflow chips are context');

console.log('\nLayer 3: wiring / safety greps');
const content = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/content.js'), 'utf8');
const hud = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/hud.css'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const options = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/options.html'), 'utf8');

check(/queue-pulse\.js/.test(manifest), 'manifest loads queue-pulse.js before content.js');
check(/queuePulseCompress/.test(content), 'content.js reads the pulse pref');
check(/data-pref="queuePulseCompress"/.test(options), 'options has a pulse checkbox');
check(/\.ch-q-pulse/.test(hud.split('{')[0]), 'hud.css token-block lists .ch-q-pulse');
check(/\.ch-q-why/.test(hud.split('{')[0]), 'hud.css token-block lists .ch-q-why');
check(/\.ch-q-act/.test(hud.split('{')[0]), 'hud.css token-block lists .ch-q-act');
check(
  /\.ch-queue-chips, \.ch-q-mon, \.ch-q-result, \.ch-q-pa, \.ch-q-pending, \.ch-q-repeat, \.ch-q-carry, \.ch-q-pulse/.test(
    content
  ),
  'refreshQueueChips wipe includes .ch-q-pulse'
);
check(/cl\.contains\('ch-q-pulse'\)/.test(content), 'observer self-write filter includes pulse');
check(/reapplyQueuePulses\(\)/.test(content), 'refreshQueueChips re-applies pulses after reinjects');
const actFn = content.match(/const buildPulseActTray = \([\s\S]*?\n  \};/);
check(!!actFn, 'buildPulseActTray found');
if (actFn) {
  check(
    !/\bDone\b|\bSent\b|\bBooked\b|\bSubmitted\b/.test(actFn[0]),
    'act tray copy-ban: no Done/Sent/Booked/Submitted'
  );
}
check(/Not a score/.test(content), 'why-tray footer refuses the score reading');
// Amber gets a rail in the same column as red (hollow, not solid) — severity
// lives on ONE axis (the rail column), distinguished by fill density/shape,
// not hue. The old standalone amber ring is retired.
check(!/ch-q-pulse-rail-ring/.test(content), 'the standalone amber ring marker is retired from content.js');
check(!/\.ch-q-pulse-rail-ring/.test(hud), 'the amber ring CSS and its token-block entry are retired from hud.css');
check(/\.ch-row-pulse-red \{[\s\S]*?inset 4px 0 0 0 var\(--red\)/.test(hud), 'red rail is still a filled inset bar');
check(
  /\.ch-row-pulse-amber \{[\s\S]*?inset 4px 0 0 0 var\(--amber-dim\)[\s\S]*?inset 1px 0 0 0 var\(--amber\)/.test(hud),
  'amber rail is a hollow wash+stroke inset, in the same rail column as red'
);
check(
  !/\.ch-row-pulse-amber \{[\s\S]*?box-shadow: inset 4px 0 0 0 var\(--(red|amber)\);/.test(hud),
  'amber rail never uses a solid single-layer ink-fill bar (shape/density, not hue, distinguishes the tiers)'
);
// The provenance diamond is replaced by an in-chip mono micro-token.
check(!/ch-q-pulse-diamond/.test(content), 'the provenance diamond marker is retired from content.js');
check(!/\.ch-q-pulse-diamond/.test(hud), 'the provenance diamond CSS is retired from hud.css');
check(/ch-q-pulse-src/.test(content), 'silent headlines get an in-chip record-source micro-token (ch-q-pulse-src)');
check(
  /composed\.silent \? ' — from the record, not the request text' : ''/.test(content),
  'silent pulse headline aria-label names the record source'
);
const applyFn = content.match(/const applyPulseRail = \([\s\S]*?\n  \};/);
check(!!applyFn, 'applyPulseRail found');
if (applyFn) {
  check(
    /rail !== 'red' && rail !== 'amber'/.test(applyFn[0]) && /PULSE_ON/.test(applyFn[0]),
    'empty rail does not hide chips (quiet row is not all-clear)'
  );
}
check(
  /escalate && composed\.headline/.test(content) && /escalate && composed\.thread/.test(content),
  'pulse compression chrome is escalate-only — quiet rows keep the chip pile'
);
check(/Nothing named matched/.test(content), 'empty why-tray refuses the all-clear reading');
const tintedFn = content.match(/const getQueueTintedRowIndexes = \(\) => \{[\s\S]*?\n  \};/);
check(!!tintedFn, 'getQueueTintedRowIndexes found');
if (tintedFn) {
  check(
    /PULSE_RED/.test(tintedFn[0]) && /PULSE_AMBER/.test(tintedFn[0]),
    'jump button / n key see pulse rails as red/amber alerts'
  );
}
check(
  /\.ch-q-focus-alerts[\s\S]{0,200}?:not\(\.ch-row-pulse-red\):not\(\.ch-row-pulse-amber\)/.test(hud) &&
    /\.ch-q-focus-alerts .ag-row:not\(\.ch-row-sev-red\):not\(\.ch-row-sev-amber\):not\(\.ch-row-pulse-red\):not\(\.ch-row-pulse-amber\)/.test(
      content
    ),
  'focus-alerts dim never fades a pulse-red/amber row (both CSS copies)'
);
check(
  /PULSE_HOST \+ \(previewRow \? '' : ' ch-q-pulse-inline'\)/.test(content),
  'flat queues (no preview) mark pulse as inline so it does not steal the name cell'
);
check(/\.ch-q-pulse-inline \{[\s\S]*?flex: 0 1 auto/.test(hud), 'inline pulse drops the preview-row 100% flex');
check(
  /\[col-id='patientName'\]:has\(> \.ch-q-pulse\)/.test(hud) &&
    /flex-direction: row/.test(hud.slice(hud.search(/\[col-id='patientName'\]:has\(> \.ch-q-result-inline\)/))) &&
    /flex-wrap: nowrap/.test(hud.slice(hud.search(/\[col-id='patientName'\]:has\(> \.ch-q-result-inline\)/))),
  'flat-queue chips sit on the same line after the name (row, nowrap — not clipped under it)'
);
check(
  /\[col-id='patientName'\] > \.ch-q-pulse \{[\s\S]*?flex: 0 1 auto/.test(hud),
  'pulse inside patientName does not take 100% of the cell'
);
check(/positionPulseFloat/.test(content), 'why/act trays are positioned as viewport popovers');
check(/ch-q-pulse-float/.test(content) && /\.ch-q-pulse-float \{/.test(hud), 'float class is styled');
check(/document\.body\.appendChild\(tray\)/.test(content), 'expanded tray is appended to body, not the grid cell');
check(
  /\[col-id='patientName'\]:has\(> \.ch-q-repeat-inline\)/.test(hud) &&
    /\[col-id='patientName'\]:has\(> \.ch-q-carry-inline\)/.test(hud),
  'repeat/carry inline chips join the same-line-after-name layout'
);
check(
  /overflow: hidden !important/.test(hud) && /\[col-id='patientName'\]:has\(> \.ch-queue-chips\)/.test(hud),
  'name cell clips chips so the next AG-Grid column cannot chop them'
);
check(
  /\[col-id='patientName'\] > \.ch-queue-chips,[\s\S]{0,900}?min-width: 1\.75rem/.test(hud),
  'flat-queue chip containers keep a min-width floor — a squeezed red/amber chip leaves a colour stub, never vanishes'
);

console.log('\nLayer 4: float lifecycle — per-key cleanup, no leaked listeners, no ghost re-open');
check(/_pulseFloatCleanups = new Map\(\)/.test(content), 'float cleanups are a per-key Map');
check(
  !/_pulseFloatCleanup\b/.test(content),
  'the single shared cleanup slot is gone (it leaked listeners every sweep)'
);
check(/runPulseFloatCleanup\(key\)/.test(content), "refreshPulseOnRow cleans up ONLY its own key's tray");
check(
  /clearTimeout\(armTimer\)/.test(content) && /const armTimer = setTimeout\(arm, 0\)/.test(content),
  'per-key cleanup cancels the pending arm — a cleanup that runs before arm leaks no listeners'
);
const dismissFn = content.match(/const dismissPulseFloats = \(\) => \{[\s\S]*?\n  \};/);
check(!!dismissFn, 'dismissPulseFloats found');
if (dismissFn) {
  check(
    /clearPulseFloatUi\(\)/.test(dismissFn[0]) && /_pulseOpenByKey/.test(dismissFn[0]),
    'dismissal closes every float AND nulls EVERY open key — a dismissed tray cannot resurrect on the next sweep'
  );
}
check(
  /const onDoc = [\s\S]{0,200}?dismissPulseFloats\(\)/.test(content) &&
    /const onKey = [\s\S]{0,200}?dismissPulseFloats\(\)/.test(content),
  'click-away and Escape route through the all-keys dismissal helper'
);
check(
  /const onScroll = \(e\) => \{[\s\S]{0,400}?tray\.contains\(e\.target\)\) return;/.test(content),
  'scrolling INSIDE the tray does not dismiss it (the tray itself has overflow-y: auto)'
);
check(
  /onScrollForMenu = \(e\) => \{[\s\S]{0,400}?activeActionMenu\.contains\(e\.target\)\) return;/.test(content),
  'scrolling INSIDE the action menu does not close it (it has a max-height scroll cap)'
);

console.log('\nLayer 5: Act button is medical/admin triage only');
check(/function isTriageQueueSlug\(slug\)/.test(content), 'isTriageQueueSlug is a named function (extractable)');
check(/function queueSlugFromHref\(href\)/.test(content), 'queueSlugFromHref is a named function (extractable)');
check(
  /const isTriageQueueNow = \(\) => isTriageQueueSlug\(currentQueueSlug\(\)\)/.test(content),
  'isTriageQueueNow composes URL-first slug + whitelist'
);
check(
  /if \(!isTriageQueueNow\(\)\) return;/.test(content),
  'a-key shortcut gates on isTriageQueueNow, not the lagging bridge slug'
);
check(
  /const showActBtn = isTriageQueueNow\(\)/.test(content),
  'refreshPulseOnRow gates Act chrome on isTriageQueueNow'
);
check(
  /open === 'act' && !showActBtn/.test(content),
  'leftover act-open state is cleared on a non-triage queue (no ghost host)'
);
check(!/isTriageQueueSlug\(_currentQueueSlug\)/.test(content), 'Act is never gated on the bridge slug alone');

const vm = require('vm');
const slugFn = content.match(/function isTriageQueueSlug\(slug\) \{[\s\S]*?\n  \}/);
const hrefFn = content.match(/function queueSlugFromHref\(href\) \{[\s\S]*?\n  \}/);
check(!!slugFn, 'isTriageQueueSlug extracted');
check(!!hrefFn, 'queueSlugFromHref extracted');
const slugBox = {};
if (slugFn && hrefFn) {
  vm.runInNewContext(
    slugFn[0] +
      '\n' +
      hrefFn[0] +
      '\nthis.isTriageQueueSlug = isTriageQueueSlug;\nthis.queueSlugFromHref = queueSlugFromHref;',
    slugBox
  );
}
const { isTriageQueueSlug, queueSlugFromHref } = slugBox;
check(typeof isTriageQueueSlug === 'function', 'isTriageQueueSlug callable');
check(typeof queueSlugFromHref === 'function', 'queueSlugFromHref callable');
if (typeof isTriageQueueSlug === 'function') {
  check(isTriageQueueSlug('medical_patient_request_task') === true, 'medical request queue is triage');
  check(isTriageQueueSlug('admin_patient_request_task') === true, 'admin request queue is triage');
  check(isTriageQueueSlug('MEDICAL_PATIENT_REQUEST_TASK') === true, 'whitelist is case-insensitive');
  const notTriage = [
    'review_investigation_results_task',
    'investigation_result_task',
    'prescription_request_task_routine',
    'prescription_request_task_non_routine',
    'routine_prescription_request_task',
    'miscellaneous_task',
    'appointments_required_task',
    'patient_questionnaire_response_task',
    'patient_privacy_officer_alert_task',
    'eps_subsequent_cancellation_task',
    'communication_thread_task',
    'medical_patient_request_task_extra',
    'x_medical_patient_request_task',
    'medical_patient_request',
    'admin_patient_request',
    '',
    null,
    undefined,
  ];
  notTriage.forEach((slug) => {
    check(isTriageQueueSlug(slug) === false, 'not triage: ' + String(slug));
  });
}
if (typeof queueSlugFromHref === 'function') {
  check(
    queueSlugFromHref('https://x.medicus.health/e38a9f/tasks/medical_patient_request_task/task-list') ===
      'medical_patient_request_task',
    'page URL yields the medical slug'
  );
  check(
    queueSlugFromHref('/e38a9f/tasks/admin_patient_request_task/task-list?statuses[]=new-request') ===
      'admin_patient_request_task',
    'page URL with query yields the admin slug'
  );
  check(
    queueSlugFromHref('/e38a9f/tasks/review_investigation_results_task/task-list') ===
      'review_investigation_results_task',
    'page URL yields the results slug'
  );
  check(
    queueSlugFromHref('/e38a9f/tasks/data/medical_patient_request_task/task-list') === 'medical_patient_request_task',
    'API /tasks/data/{slug}/task-list shape still yields the real slug'
  );
  check(queueSlugFromHref('/e38a9f/tasks/data/task-list') === '', 'bare /tasks/data/task-list is not a queue type');
  check(queueSlugFromHref('/e38a9f/care-record/abc') === '', 'non-queue URL yields empty slug');
  check(queueSlugFromHref('') === '' && queueSlugFromHref(null) === '', 'empty/null href fails closed');
}

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---\n');
if (failed > 0) process.exit(1);
