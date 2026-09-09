// Medicus Suite — floating Companion "What's due" source invariants
// Run with: node test-task-actions-due.js
//
// The due strip lives inside the task-actions IIFE and can't be imported, so
// these are source-level safety pins: identity gate, no all-clear claim, the
// snapshot is read (never re-evaluated with a partial ruleset), and the
// Companion role toggle does not bypass those controls.

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
    process.exitCode = 1;
  }
}

const panel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.css'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const sentinel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');

console.log('--- manifest wires due-mini + companion-role before the panel ---');
{
  const tapBlock = manifest.slice(manifest.indexOf('shared/due-mini.js'));
  const dueIdx = tapBlock.indexOf('shared/due-mini.js');
  const roleIdx = tapBlock.indexOf('shared/companion-role.js');
  const panelIdx = tapBlock.indexOf('content-scripts/task-actions-panel.js');
  check(dueIdx !== -1 && panelIdx !== -1 && dueIdx < panelIdx, 'due-mini.js is injected before task-actions-panel.js');
  check(roleIdx !== -1 && roleIdx < panelIdx, 'companion-role.js is injected before task-actions-panel.js');
}

console.log('\n--- identity gate ---');
check(
  /dueFromSnapshot/.test(panel),
  'panel calls MsDueMini.dueFromSnapshot (identity gate lives in the tested module)'
);
check(/__msReadSentinelSnapshot/.test(panel), 'panel reads the live snapshot via __msReadSentinelSnapshot');
check(/st !== s\.due/.test(panel), 'loadWhatsDue pins due sub-state across the patient-id await');
check(/live\.pageKey !== ctx\.pageKey/.test(panel), 'loadWhatsDue re-checks the live pageKey after the resolve await');
check(/stopDuePoll\(\)/.test(panel), 'SPA navigation / pagehide stops the due poll');
check(/state === 'pending' && s\.due\.mini/.test(panel), 'a pending snapshot clears any painted chips immediately');
check(/function clearDuePaint/.test(panel), 'path change clears painted due chips synchronously');
check(
  /if \(pathChanged\) clearDuePaint\(\)/.test(panel),
  'scheduleInject calls clearDuePaint on path change before the inject throttle'
);
check(
  /if \(_throttle\) return/.test(panel) &&
    panel.indexOf('if (pathChanged) clearDuePaint()') < panel.indexOf('if (_throttle) return'),
  'path-change clear runs even when a throttle is already armed'
);
check(
  (() => {
    // Scoped to loadPatientRecord's own body (both the 'record'-kind branch
    // and the 'task'-kind classify-then-fetch branch use the same
    // st.loadedForTask = ctx.pageKey idiom loadWhatsDue also uses elsewhere
    // in this file, so the check has to be scoped by function body, not by
    // a literal unique to this one function — 2026-08-26, when
    // loadPatientRecord was extended to also run on care-record pages).
    const recBody = (panel.split('async function loadPatientRecord')[1] || '').split('async function doOpenBooking')[0];
    const setIdx = recBody.indexOf('st.loadedForTask = ctx.pageKey');
    const firstAwaitIdx = recBody.indexOf('await ');
    return setIdx > -1 && firstAwaitIdx > -1 && setIdx > firstAwaitIdx;
  })(),
  'loadedForTask is set only after a successful patient resolve (one-shot fail is retryable)'
);
check(/function retryWhatsDue/.test(panel) && /ms-tap-due-retry/.test(panel), 'error state offers Try again');
check(/scheduleDueRetry/.test(panel), 'resolve failure schedules an automatic retry');
check(/function countInt/.test(panel), 'due counts are coerced to integers before HTML interpolation');
check(!/evaluatePatient/.test(panel), 'panel does not re-evaluate rules itself (would risk a partial ruleset)');
check(/function setRole/.test(panel) && /ms-tap-role/.test(panel), 'Companion role toggle is wired');
check(/dueVoiceForRole/.test(panel), 'role change rebuilds due-mini with the matching voice');
check(/writeSavedRole/.test(panel), 'chosen role is persisted (never yanked mid-clinic)');
check(/Pulse is on the medical queue/.test(panel), 'triage off the queue stays honest (no invented counts)');
check(!/Open the medical queue for the pulse/.test(panel), 'off-queue pulse copy is not a fake button');
check(/moreLineText/.test(panel), '+N more uses the tested moreLineText helper ("of them overdue")');
check(/ms-tap-due-show-all/.test(panel), 'overflow expands in the widget (default still 4)');
check(/Open Monitoring/.test(panel), 'Monitoring is a real open-panel control');
check(/Open Slot Counter/.test(panel), 'Slot Counter is a real open-panel control');
check(/Already booked/.test(panel), 'reception sees this-patient future appointments');
check(/ms-open-panel/.test(panel), 'panel open goes through the allow-listed SW action');
check(/suggestedBookHint/.test(panel), 'reception due rows carry a book-type hint');
check(/roleCaption/.test(panel), 'role pills have a one-line caption');
check(/lang.*en-GB/.test(panel), 'widget is en-GB so the date field is not US-formatted');
{
  const sw = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
  check(/case 'ms-open-panel'/.test(sw), 'service worker handles ms-open-panel');
  check(/mod !== 'sentinel' && mod !== 'slots'/.test(sw), 'ms-open-panel allow-lists only Monitoring and Slot Counter');
}
check(/Couldn't load the desk glance/.test(panel), 'desk fetch failure is named, not painted as zero');
check(
  /appointment-book\/embedded-overview/.test(panel),
  'slots glance uses the Slot Counter embedded-overview scrape, not the first two finder types'
);
check(/slotsFromOverview/.test(panel), 'slots glance maps the overview through the tested helper');
check(/ms-tap-title">Companion</.test(panel), 'header title is Companion');
check(/ms-tap-minimise/.test(panel), 'header has a dedicated Minimise / Restore button');
check(/ms-tap-icon-btn/.test(panel) && /function iconSvg/.test(panel), 'chrome uses stroke icons, not Unicode corners');
check(!/⌞/.test(panel), 'pop-in control is not the ⌞ character that rendered as L');
check(/ms-tap-mark/.test(panel) && /ms-tap-dock-chevron/.test(panel), 'header and docked tab share the Companion mark');
check(
  /ms-tap-signal-red/.test(panel) && /function dueSignal/.test(panel),
  'collapsed / docked chrome carries a severity signal class'
);
check(/ms-companion-collapsed/.test(panel), 'minimise state is persisted in localStorage');
check(/function readCollapsed/.test(panel) && /function writeCollapsed/.test(panel), 'collapsed persist helpers exist');
check(/function setCollapsed/.test(panel), 'title click and minimise both go through setCollapsed');
check(/ms-tap-minimised/.test(css), 'minimised chrome shrinks to a compact bar');
check(/ms-tap-icon-btn/.test(css) && /transparent/.test(css), 'chrome buttons are ghost at rest');
check(/ms-tap-dock-tab/.test(panel) && /ms-tap-docked/.test(css), 'Companion can pop in to an edge tab');
check(/ms-tap-signal-red::before/.test(css), 'reduced states promote severity onto the identity hairline');
{
  const dockFn = panel.slice(panel.indexOf('function setDocked'), panel.indexOf('function outerCollapsedDueBadge'));
  check(dockFn.length > 80 && /apiReleaseReservation/.test(dockFn), 'popping in releases any held booking reservation');
}
check(/ms-tap-resize/.test(panel) && /nwse-resize/.test(css), 'Companion has a resize handle');
check(/Show on every Medicus screen/.test(panel), 'all-screens opt-in is in the widget, not forced on');
{
  const roleSrc = fs.readFileSync(path.join(__dirname, 'shared', 'companion-role.js'), 'utf8');
  check(/ms-companion-all-screens/.test(roleSrc), 'all-screens preference is persisted');
  check(/kind: 'elsewhere'/.test(roleSrc), 'all-screens patient pages are a distinct elsewhere kind');
}

console.log('\n--- snapshot ping ---');
check(/ms-sentinel-snapshot/.test(panel), 'panel listens for the same-page snapshot ping');
check(
  /__msReadSentinelSnapshot/.test(sentinel) && /ms-sentinel-snapshot/.test(sentinel),
  'sentinel exposes the reader and the ping'
);

console.log('\n--- no completion / all-clear claim ---');
{
  const dueChunk = panel.slice(panel.indexOf('function dueDegradedHtml'), panel.indexOf('function apptStatusLabel'));
  check(dueChunk.length > 200, 'due HTML helpers are present');
  check(!/\ball clear\b/i.test(dueChunk), 'due UI never says "all clear"');
  check(!/\bsafe to\b/i.test(dueChunk), 'due UI never says "safe to"');
  check(!/\b(Done|Sent|Booked|Submitted)\b/.test(dueChunk), 'due UI never claims completion');
  check(/Nothing due right now/.test(dueChunk), 'empty state is bounded ("nothing due right now")');
  check(
    /Couldn\\u2019t verify everything that\\u2019s due/.test(dueChunk),
    'journal / unmatched-high-risk empty state does not claim nothing due'
  );
  check(/Journal data unavailable/.test(dueChunk), 'journal-augment failure is named on the strip');
  check(/high-risk medicine/.test(dueChunk), 'unmatched high-risk drugs are named on the strip');
  check(/Couldn\\u2019t classify alerts/.test(dueChunk), 'unrecognised chip statuses fail closed, not as nothing due');
  check(/Monitoring/.test(dueChunk), 'overflow / empty points at Monitoring for the full list');
  check(/moreRed/.test(dueChunk), 'hidden reds are named in the "+N more" line');
  check(/No recent/.test(dueChunk), 'no_data drug-monitoring gets a No recent tag, not Overdue');
}

console.log('\n--- Upcoming: outstanding investigations wiring ---');
check(
  manifest.indexOf('shared/outstanding-investigations.js') > -1 &&
    manifest.indexOf('shared/outstanding-investigations.js') <
      manifest.indexOf('content-scripts/task-actions-panel.js'),
  'outstanding-investigations.js is injected before task-actions-panel.js'
);
check(/apiFetchPatientJournal/.test(panel), 'panel fetches the patient journal for outstanding investigations');
check(/MsOutstandingInvestigations/.test(panel), 'parsing is delegated to the shared module, not duplicated inline');
check(/Outstanding investigations/.test(panel), 'clinic Upcoming section has the Outstanding investigations heading');
check(/No outstanding investigations\./.test(panel), 'empty state is named, not blank');
check(
  /Awaiting a result — not confirmation the request reached the lab\./.test(panel),
  'the sent-vs-awaiting caveat is said in the UI itself (H-069), not only in a code comment'
);
check(
  (() => {
    const recBody = (panel.split('function renderRecordBody')[1] || '').split('function recordSectionHtml')[0];
    // Reception's early-return branch (before the Unused-booking-links group)
    // must not mention investigations at all — the section stays clinic-only
    // for that group, same scoping as the existing booking-links heading.
    const receptionBranch = recBody.split(`currentRole() === 'reception') {`)[1].split('}')[0];
    return !/Outstanding investigations/.test(receptionBranch);
  })(),
  "reception's Already-booked view stays appointments-only (no investigations)"
);
check(
  /Open appts, links, tasks & investigations/.test(panel),
  'clinic section heading names all four lists it now holds'
);
check(
  /function renderRecGroup/.test(panel) && /groupsOpen\[key\] !== false/.test(panel),
  'each sub-list (appts / links / tasks / investigations) collapses independently via renderRecGroup'
);
check(
  /groupsOpen: \{ appts: true, links: true, tasks: true, investigations: true \}/.test(panel),
  'sub-lists default to expanded so existing users see no change until they collapse one'
);
check(
  /ms-tap-rec-grp-.*addEventListener\('click'/.test(panel) || /grpToggle\.addEventListener\('click'/.test(panel),
  'sub-list headings are wired to toggle + rerender, same pattern as the top-level section chevrons'
);

console.log('\n--- Outstanding investigations: weekday abbreviation (2026-09-11) ---');
check(
  /const WEEKDAY_ABBR = \['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'\];/.test(panel),
  'weekday abbreviations disambiguate Tuesday/Thursday and Saturday/Sunday, not just single letters'
);
check(
  /function weekdayAbbr/.test(panel) && /Date\.parse\(dateStr\)/.test(panel),
  'reuses Date.parse on the same requestedDate string outstandingInvestigationRequests() already sorts by'
);
check(
  (() => {
    const fn = panel.slice(panel.indexOf('function weekdayAbbr'), panel.indexOf('function renderInvestigationRow'));
    return /if \(Number\.isNaN\(ms\)\) return ''/.test(fn);
  })(),
  'an unparseable/missing date returns empty string, never NaN painted into the row'
);
check(
  (() => {
    const fn = panel.slice(panel.indexOf('function renderInvestigationRow'), panel.indexOf('function renderRecGroup'));
    return /const weekday = weekdayAbbr\(inv\.requestedDate\);/.test(fn) && /weekday \? weekday \+ ' ' : ''/.test(fn);
  })(),
  'renderInvestigationRow prefixes the date with the weekday abbreviation when one is available'
);
check(
  (() => {
    // Scoped elsewhere in the file (appts/links/tasks) never call
    // weekdayAbbr — Nick's own request was "just for outstanding
    // investigation results".
    const apptFn = panel.slice(panel.indexOf('function renderApptRow'), panel.indexOf('function renderLinkRow'));
    const linkFn = panel.slice(panel.indexOf('function renderLinkRow'), panel.indexOf('function weekdayAbbr'));
    const taskFn = panel.slice(panel.indexOf('function renderTaskRow'), panel.indexOf('function renderRecordBody'));
    return !/weekdayAbbr/.test(apptFn) && !/weekdayAbbr/.test(linkFn) && !/weekdayAbbr/.test(taskFn);
  })(),
  'appointments/links/tasks rows are untouched — the weekday is investigations-only, as asked'
);

console.log('\n--- Companion: investigation-results task pages get record section first (2026-09-11) ---');
check(
  /function isInvestigationResultTask/.test(panel) &&
    /INVESTIGATION_REPORT_TASK_TYPE = 'review-investigation-report'/.test(panel) &&
    /info\.typeSlug === INVESTIGATION_REPORT_TASK_TYPE/.test(panel),
  'matches the exact confirmed typeSlug (review-investigation-report), not a broader speculative pattern'
);
check(
  /const recordFirst = showRecord && isInvestigationResultTask\(\);/.test(panel),
  'buildHtml() computes whether the record section should render before What’s due'
);
check(
  (() => {
    const fn = panel.slice(panel.indexOf('function buildHtml'), panel.indexOf('function dueDegradedHtml'));
    const recordFirstIdx = fn.indexOf("recordFirst ? recordSectionHtml() : ''");
    const dueIdx = fn.indexOf('shows.due ? dueSectionHtml()');
    return recordFirstIdx > -1 && dueIdx > -1 && recordFirstIdx < dueIdx;
  })(),
  "the record-first slot renders BEFORE the What's due section in buildHtml()'s markup order"
);
check(
  /showRecord && !recordFirst \? recordSectionHtml\(\) : ''/.test(panel),
  'the record section still renders in its original spot on every other page, never duplicated'
);
check(
  /const investigationsGroup = renderRecGroup\('investigations', 'Outstanding investigations', investigationsHtml\);/.test(
    panel
  ),
  'the investigations group is built once and reused for either ordering, not duplicated per branch'
);
check(
  /isInvestigationResultTask\(\)\s*\?\s*investigationsGroup \+ otherGroups\s*:\s*otherGroups \+ investigationsGroup/.test(
    panel
  ),
  'within the record section, Outstanding investigations sorts first on investigation-results pages, last everywhere else (unchanged order)'
);
check(
  (() => {
    // Root cause found after Nick reported "nothing showing at all":
    // ordering alone did nothing, because loadPatientRecord's Stage-1
    // classifyPatientRequest() only ever recognises a communication-thread
    // overview shape (data.communicationThreadTaskType) — a
    // review-investigation-report task's overview is a different shape
    // entirely and was always falling through to applicable = false.
    const fn = panel.slice(
      panel.indexOf('async function loadPatientRecord'),
      panel.indexOf('async function doOpenBooking')
    );
    return (
      /if \(ctx\.typeSlug === INVESTIGATION_REPORT_TASK_TYPE\)/.test(fn) &&
      /invOverview\.data && invOverview\.data\.patient && invOverview\.data\.patient\.id/.test(fn) &&
      fn.indexOf('INVESTIGATION_REPORT_TASK_TYPE') < fn.indexOf('classifyPatientRequest(overview)')
    );
  })(),
  'review-investigation-report tasks get their own applicable/patientId path (HAR 122-open-investigation.har: data.patient.id), bypassing the communication-thread-only classifier entirely'
);
check(
  (() => {
    const fn = panel.slice(
      panel.indexOf('async function loadPatientRecord'),
      panel.indexOf('async function doOpenBooking')
    );
    const start = fn.indexOf('if (ctx.typeSlug === INVESTIGATION_REPORT_TASK_TYPE)');
    const stage1Idx = fn.indexOf('// Stage 1');
    const invBranch = fn.slice(start, stage1Idx);
    return /fetchAppointmentsAndLinks\(st, patientId, ctx\.taskUuid\)/.test(invBranch);
  })(),
  "the investigation-report task itself is excluded from its own Open tasks list, same as the communication-thread path's ctx.taskUuid exclusion"
);
check(
  (() => {
    // Second root cause, found after "still not showing" even with the
    // classification-shape fix above in place: runInject() is the trigger
    // that decides whether loadPatientRecord() is called AT ALL — it only
    // fired for isCommunicationThreadSlug(ctx.typeSlug), so the earlier fix
    // was genuinely dead code, never reached for this typeSlug at all.
    const fn = panel.slice(panel.indexOf('function runInject'), panel.indexOf('const _hub = window.__chObserverHub'));
    return (
      /isCommunicationThreadSlug\(ctx\.typeSlug\) \|\| ctx\.typeSlug === INVESTIGATION_REPORT_TASK_TYPE/.test(fn) &&
      fn.indexOf('(isCommunicationThreadSlug(ctx.typeSlug) || ctx.typeSlug === INVESTIGATION_REPORT_TASK_TYPE)') <
        fn.indexOf('loadPatientRecord(ctx)')
    );
  })(),
  "runInject()'s own trigger for loadPatientRecord() also recognises review-investigation-report — the actual reason nothing showed, one layer above the classification fix"
);

console.log('\n--- Booking-link rows: lozenge, no colour, type first ---');
check(
  /function dateOnlyFromCreated/.test(panel) && /str\.indexOf\(','\)/.test(panel),
  'booking-link date is truncated at the comma, not parsed as a real date'
);
check(
  /function bookingLinkTypeName/.test(panel) && /v !== '-'/.test(panel),
  'Medicus\'s "-" not-set placeholder is treated as unset, not displayed literally (the procedure-link bug)'
);
check(
  (() => {
    const fn = panel.slice(panel.indexOf('function renderLinkRow'), panel.indexOf('function renderInvestigationRow'));
    return (
      !/Sent /.test(fn) &&
      /ms-tap-rec-pill"/.test(fn) &&
      /ms-tap-rec-pill-text/.test(fn) &&
      /ms-tap-rec-status/.test(fn) &&
      !/ms-tap-rec-status ms-tap-rec-status-/.test(fn) &&
      fn.indexOf('ms-tap-rec-pill-text') < fn.indexOf('ms-tap-rec-status')
    );
  })(),
  'link row is a single-line pill: type (+ reason inline) first, then a plain (unmodified-class, so uncoloured) date pill, no "Sent" prefix'
);
check(/ms-tap-rec-pill\b/.test(css) && /ms-tap-rec-pill-text/.test(css), 'the pill row style is defined in CSS');

console.log('\n--- Open tasks (part of the same section) ---');
check(
  /clinical\/data\/patient-record\/task-list\//.test(panel),
  'open-tasks fetch uses the confirmed per-patient task-list endpoint (HAR 110-tasklist.har)'
);
check(
  /statuses\[\]', 'incomplete'/.test(panel) && /statuses\[\]', 'snoozed'/.test(panel),
  'requests only incomplete + snoozed (scheduled for later) — completed/discarded excluded server-side'
);
check(
  !/statuses\[\]', 'completed'/.test(panel) && !/statuses\[\]', 'cancelled'/.test(panel),
  'never requests completed or discarded tasks'
);
check(
  /function taskUuidFromOverviewUrl/.test(panel) && /excludeTaskUuid/.test(panel),
  'the task the clinician is already viewing is excluded from its own open-tasks list'
);
check(
  /fetchAppointmentsAndLinks\(st, classification\.patientId, ctx\.taskUuid\)/.test(panel),
  'the task-page call site passes its own taskUuid to exclude'
);
check(
  /fetchAppointmentsAndLinks\(st, ctx\.patientId\);/.test(panel),
  'the record-page call site has no current task to exclude'
);
check(
  (() => {
    const fn = panel.slice(panel.indexOf('function renderTaskRow'), panel.indexOf('function renderRecordBody'));
    return /ms-tap-rec-pill"/.test(fn) && /ms-tap-rec-pill-text/.test(fn);
  })(),
  'open tasks render as the same single-line pill as booking links, for consistency'
);
check(
  /ms-tap-rec-status-overdue/.test(panel) && /ms-tap-rec-status-overdue/.test(css),
  'overdue tasks get a named pill, styled in CSS'
);
check(/No open tasks\./.test(panel), 'empty state is named, not blank');
check(
  (() => {
    const recBody = (panel.split('function renderRecordBody')[1] || '').split('function recordSectionHtml')[0];
    const receptionBranch = recBody.split(`currentRole() === 'reception') {`)[1].split('}')[0];
    return !/Open tasks/.test(receptionBranch);
  })(),
  "reception's Already-booked view stays appointments-only (no open tasks)"
);

console.log('\n--- CSS: hue is never the only signal ---');
check(/ms-tap-due-red \.ms-tap-due-dot/.test(css) && /background: var\(--red\)/.test(css), 'red due-dot is filled');
check(
  /ms-tap-due-amber \.ms-tap-due-dot/.test(css) && /background: transparent/.test(css),
  'amber due-dot is a hollow ring'
);
check(/ms-tap-due-tag/.test(css), 'status tag accompanies the dot');
check(/--red-dim/.test(css) && /--amber-dim/.test(css), 'due styles consume scoped status tokens');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
