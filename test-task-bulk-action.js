// Medicus Suite — task-bulk-action (generic "Bulk <verb>?" engine) tests
// Run with: node test-task-bulk-action.js
//
// Live Medicus, AG Grid and the DOM aren't available here, so this exercises:
//   (a) the pure engine helpers (task-bulk-action.js) — the {taskId} POST
//       payload, page-path detection, the select/keep partition, the submit
//       guard;
//   (b) source-level regression locks on both instantiation files
//       (privacy-officer-bulk-acknowledge.js / eps-cancellation-bulk-discard.js)
//       pinning the literal confirmed contract values (task-list slug,
//       action endpoint, list query) — these were each confirmed live via a
//       real HAR/copy-as-fetch capture (see CHANGELOG), so a source-text
//       regression here catches an accidental edit drifting away from what
//       was actually confirmed, the same discipline test-oir-key-rotation.js
//       already applies to options.js.

'use strict';

const fs = require('fs');
const path = require('path');

const {
  apiErrorMessage,
  parseQueuePagePath,
  extractTaskArray,
  taskIdFromRow,
  partitionSelection,
  canSubmit,
  buildActionPayload,
  normaliseListQuery,
} = require('./content-scripts/task-bulk-action.js');

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

console.log('--- buildActionPayload: the confirmed {taskId} contract shared by both task types ---');
{
  const payload = buildActionPayload('task-1');
  check(payload.taskId === 'task-1', 'taskId passed through');
  check(Object.keys(payload).join(',') === 'taskId', 'exactly one field, nothing extra');
}

console.log('\n--- apiErrorMessage: status + best-effort body detail ---');
{
  check(apiErrorMessage(400, '') === 'API 400', 'no body -> bare status');
  check(apiErrorMessage(400, '{"message":"Bad thing"}') === 'API 400 — Bad thing', 'JSON message field extracted');
  check(apiErrorMessage(400, '{"error":"Nope"}') === 'API 400 — Nope', 'JSON error field extracted');
  check(apiErrorMessage(500, 'plain text failure') === 'API 500 — plain text failure', 'non-JSON body used as-is');
  const longBody = 'x'.repeat(300);
  check(apiErrorMessage(400, longBody).length < 250, 'long detail is clipped');
}

console.log('\n--- parseQueuePagePath: /{site}/tasks/{slug}/task-list detection ---');
{
  check(
    JSON.stringify(
      parseQueuePagePath(
        '/e38a9f/tasks/patient_privacy_officer_alert_task/task-list',
        'patient_privacy_officer_alert_task'
      )
    ) === JSON.stringify({ siteId: 'e38a9f' }),
    'matches the confirmed Privacy Officer task-list path'
  );
  check(
    JSON.stringify(
      parseQueuePagePath('/e38a9f/tasks/eps_subsequent_cancellation_task/task-list', 'eps_subsequent_cancellation_task')
    ) === JSON.stringify({ siteId: 'e38a9f' }),
    'matches the confirmed EPS task-list path'
  );
  check(
    parseQueuePagePath('/e38a9f/tasks/some_other_task/task-list', 'patient_privacy_officer_alert_task') === null,
    "a DIFFERENT task type's list page does not match — each instantiation only reacts to its own slug"
  );
  check(
    parseQueuePagePath(
      '/e38a9f/tasks/patient_privacy_officer_alert_task/overview/abc',
      'patient_privacy_officer_alert_task'
    ) === null,
    'an overview page (not task-list) does not match'
  );
  check(parseQueuePagePath(null, 'patient_privacy_officer_alert_task') === null, 'null pathname -> null, never throws');
  check(parseQueuePagePath('/e38a9f/tasks/x/task-list', '') === null, 'empty slug -> null, never a wildcard match');
  check(
    JSON.stringify(
      parseQueuePagePath(
        '/e38a9f/tasks/data/patient_privacy_officer_alert_task/task-list',
        'patient_privacy_officer_alert_task'
      )
    ) === JSON.stringify({ siteId: 'e38a9f' }),
    'also matches the /tasks/data/{slug}/task-list URL shape'
  );
  check(
    JSON.stringify(
      parseQueuePagePath(
        '/e38a9f/tasks/patient-privacy-officer-alert-task/task-list',
        'patient_privacy_officer_alert_task'
      )
    ) === JSON.stringify({ siteId: 'e38a9f' }),
    'hyphenated URL slug still matches the underscore API slug — otherwise the Bulk button never appears'
  );
  check(
    parseQueuePagePath(
      '/prefix/e38a9f/tasks/patient_privacy_officer_alert_task/task-list',
      'patient_privacy_officer_alert_task'
    ) === null,
    'anchored: the siteId must be the FIRST path segment, never fished out mid-path'
  );
}

console.log('\n--- extractTaskArray / taskIdFromRow: envelopes and id aliases ---');
{
  check(extractTaskArray({ tasks: [{ id: 'a' }] })[0].id === 'a', 'top-level tasks[] (confirmed capture shape)');
  check(extractTaskArray({ data: { tasks: [{ id: 'b' }] } })[0].id === 'b', 'nested data.tasks[]');
  check(extractTaskArray({ data: [{ id: 'c' }] })[0].id === 'c', 'data as a bare array');
  check(extractTaskArray(null).length === 0, 'null body -> [], never throws');
  check(extractTaskArray({ foo: 1 }).length === 0, 'unknown envelope -> [], never throws');
  check(taskIdFromRow({ id: 'x' }) === 'x', 'id is preferred');
  check(taskIdFromRow({ taskUuid: 'u' }) === 'u', 'taskUuid is used when id is missing');
  check(taskIdFromRow({ taskId: 't' }) === 't', 'taskId is used when id is missing');
  check(taskIdFromRow(null) === '', 'null row -> empty id, never throws');
}

console.log('\n--- partitionSelection: acting vs keeping, already-acted rows excluded from both being re-acted ---');
{
  const rows = [
    { id: '1', checked: true, acted: false },
    { id: '2', checked: false, acted: false },
    { id: '3', checked: true, acted: true }, // already acted this session — must not re-fire
  ];
  const parts = partitionSelection(rows);
  check(parts.acting.length === 1 && parts.acting[0].id === '1', 'only the checked, not-yet-acted row is in "acting"');
  check(parts.keeping.length === 1 && parts.keeping[0].id === '2', 'the unchecked row is "keeping"');
  check(
    !parts.acting.some((r) => r.id === '3') && !parts.keeping.some((r) => r.id === '3'),
    'an already-acted row appears in NEITHER partition — it is done, not pending either way'
  );
}

console.log('\n--- canSubmit: the one guard behind both the buttons and runAction() ---');
{
  check(canSubmit(1, false) === true, 'selected + not mid-batch -> submittable');
  check(canSubmit(0, false) === false, 'nothing selected -> not submittable');
  check(canSubmit(1, true) === false, 'a batch already in flight -> not submittable (no double-fire)');
}

console.log('\n--- normaliseListQuery: string vs { qs, scopeWarning } resolution ---');
{
  const plain = normaliseListQuery('a=1&b=2');
  check(plain.qs === 'a=1&b=2' && plain.scopeWarning === null, 'plain string -> qs as-is, no warning');
  const scoped = normaliseListQuery({ qs: 'a=1', scopeWarning: 'list is wider than yours' });
  check(scoped.qs === 'a=1' && scoped.scopeWarning === 'list is wider than yours', 'object shape carries both parts');
  const noWarn = normaliseListQuery({ qs: 'a=1' });
  check(noWarn.scopeWarning === null, 'object without scopeWarning -> null, not undefined');
  const empty = normaliseListQuery(null);
  check(empty.qs === '' && empty.scopeWarning === null, 'null input degrades to an empty query, never throws');
}

console.log('\n--- Engine source lock: delegated clicks cannot POST outside the confirm step; re-inserted widget repaints ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.js'), 'utf8');
  check(
    /async function runAction\(\) \{[\s\S]{0,400}?if \(_step !== 'confirm'\) return;/.test(src),
    'runAction() refuses to POST unless the engine is on the confirm step (a stale clone Confirm cannot write)'
  );
  check(
    /if \(action === 'confirm'\) \{\s*if \(_step !== 'confirm'\) return;/.test(src),
    "dispatcher gates 'confirm' on _step === 'confirm'"
  );
  check(
    /if \(action === 'back'\) \{\s*if \(_step !== 'confirm'\) return;/.test(src),
    "dispatcher gates 'back' on _step === 'confirm'"
  );
  check(
    /function render\(\) \{[\s\S]{0,600}?var el = _widgetEl \|\| document\.getElementById\(widgetId\);/.test(src),
    'render() paints our own node even while Vue has it detached'
  );
  check(
    /var wasConnected = document\.contains\(_widgetEl\);[\s\S]{0,900}?if \(!wasConnected && document\.contains\(_widgetEl\)\) \{\s*_widgetEl\.innerHTML = buildHtml\(\);/.test(src),
    'injectTrigger repaints a node it re-inserts after Vue stripped it'
  );
}

console.log('\n--- Engine source lock: a widened scope must be VISIBLE, but select-all is no longer withheld ---');
{
  // Post-merge review of #272, finding 2: the unscoped privacy-officer
  // fallback used to render identically to the correctly-scoped case, so
  // "Select all + Confirm" could acknowledge OTHER officers' alerts with no
  // sign anything was different. The banner pin (below) still holds — the
  // widened scope must still be VISIBLE. The select-all-withholding pin was
  // REMOVED 2026-08-20 (Nick's explicit request, privacy-officer role): the
  // identity-stamp resolution never succeeds for his workflow, so the
  // fallback — and the withhold — was permanent, not occasional, blocking a
  // legitimate bulk action he's authorised to take. This is now a warning to
  // review before confirming, not a block.
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.js'), 'utf8');
  check(src.includes('ms-tba-scope-warning'), 'engine renders a dedicated scope-warning element');
  check(
    !/config\.selectAllAllowed && !_scopeWarning/.test(src),
    'select-all is no longer gated on the scope warning — a scope warning is a banner, not a block'
  );
  const selectStep = src.slice(src.indexOf('function renderSelectStep'), src.indexOf('function renderConfirmStep'));
  const confirmStep = src.slice(src.indexOf('function renderConfirmStep'), src.indexOf('function renderDoneStep'));
  check(selectStep.includes('scopeWarningHtml()'), 'select step shows the warning');
  check(confirmStep.includes('scopeWarningHtml()'), 'confirm step repeats the warning at the point of commitment');
  check(
    src.includes('_scopeWarning = result.scopeWarning') &&
      src.indexOf('_scopeWarning = result.scopeWarning') > src.indexOf('gen !== _generation) return; // navigated'),
    'the warning is applied only after the load generation check (stale fetch cannot pollute the next page entry)'
  );
  check(src.includes('_scopeWarning = null'), 'removeWidget resets the warning with the rest of the state');
}

console.log('\n--- Privacy Officer Alerts instantiation: confirmed contract regression lock ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'privacy-officer-bulk-acknowledge.js'), 'utf8');
  check(src.includes("taskListSlug: 'patient_privacy_officer_alert_task'"), 'confirmed task-list slug present');
  check(
    src.includes("actionPath: '/tasks/patient-privacy-officer/complete'"),
    'confirmed acknowledge endpoint present'
  );
  check(src.includes('statuses%5B%5D=pending&viewContext=homepage'), 'confirmed list query present');
  check(src.includes('data-ch-staff'), 'reads the live staff-identity stamp rather than a hardcoded assignee UUID');
  check(!/masterAssignee=0[0-9a-f-]{30,}/.test(src), 'no hardcoded staff UUID baked into the source');
  check(src.includes('scopeWarning:'), 'the unscoped fallback carries a scopeWarning — never a silent widening');
  check(
    src.includes('ALL staff'),
    'the warning states the consequence (whose alerts are on screen), not just the mechanism'
  );
  check(/waited < 5000/.test(src), 'waits for the identity stamp before falling back to an unscoped fetch');
  check(src.includes('selectAllAllowed: true'), 'select-all enabled per the 2026-08-08 decision');
  check(src.includes("verbGerund: 'Acknowledging'"), 'explicit correct gerund spelling, not derived from verb + "ing"');
}

console.log('\n--- EPS Cancellation Failures instantiation: confirmed contract regression lock ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'eps-cancellation-bulk-discard.js'), 'utf8');
  check(src.includes("taskListSlug: 'eps_subsequent_cancellation_task'"), 'confirmed task-list slug present');
  check(
    src.includes("actionPath: '/tasks/eps-prescription-order-item/cancellation/mark-as-no-longer-needed'"),
    'confirmed discard endpoint present — the DIFFERENT slug family from the task type itself'
  );
  check(
    src.includes('statuses%5B%5D=incomplete&statuses%5B%5D=pharmacy-contacted&viewContext=workflow'),
    'confirmed list query present, including BOTH statuses'
  );
  const listQueryLine = src.match(/listQueryString:\s*'[^']*'/);
  check(
    !!listQueryLine && !listQueryLine[0].includes('masterAssignee'),
    'the actual list query value has no assignee scoping — the confirmed EPS query never had one'
  );
  check(src.includes('selectAllAllowed: true'), 'select-all enabled per the 2026-08-08 decision');
  check(
    src.includes("verbGerund: 'Discarding'"),
    'explicit gerund spelling present (Discard has no silent-e issue, but the field is still required)'
  );
}

console.log('\n--- Gerund spelling: the engine never derives it by concatenation ---');
{
  const engineSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.js'), 'utf8');
  check(
    !/config\.verb\s*\+\s*['"]ing/.test(engineSrc),
    'the engine no longer appends "ing" to config.verb (that produced "Acknowledgeing")'
  );
  check(engineSrc.includes('config.verbGerund'), 'the engine uses the explicit verbGerund field instead');
}

console.log('\n--- Both instantiations register through the shared engine, not a duplicated copy ---');
{
  const poSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'privacy-officer-bulk-acknowledge.js'), 'utf8');
  const epsSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'eps-cancellation-bulk-discard.js'), 'utf8');
  check(poSrc.includes('window.TaskBulkAction.create('), 'Privacy Officer instantiates the shared engine');
  check(epsSrc.includes('window.TaskBulkAction.create('), 'EPS instantiates the shared engine');
  check(
    !/function\s+buildHtml|function\s+renderSelectStep/.test(poSrc),
    'Privacy Officer does not reimplement rendering logic'
  );
  check(!/function\s+buildHtml|function\s+renderSelectStep/.test(epsSrc), 'EPS does not reimplement rendering logic');
}

console.log('\n--- manifest.json wiring ---');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const medicusBlock = manifest.content_scripts.find(
    (b) => Array.isArray(b.js) && b.js.some((f) => f.includes('problem-bulk-end.js'))
  );
  check(!!medicusBlock, 'found the medicus.health content-scripts block that other record-tidy widgets share');
  const js = medicusBlock.js;
  const engineIdx = js.indexOf('content-scripts/task-bulk-action.js');
  const poIdx = js.indexOf('content-scripts/privacy-officer-bulk-acknowledge.js');
  const epsIdx = js.indexOf('content-scripts/eps-cancellation-bulk-discard.js');
  check(engineIdx !== -1 && poIdx !== -1 && epsIdx !== -1, 'all three files are registered');
  check(engineIdx < poIdx && engineIdx < epsIdx, 'the shared engine loads BEFORE either instantiation');
  check(medicusBlock.css.includes('content-scripts/task-bulk-action.css'), 'shared CSS is registered');
}

console.log('\n--- Widget persistence: Vue strip must re-inject, not be treated as own-write ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.js'), 'utf8');
  check(
    src.includes('_onMatchingPage && !liveWidget()'),
    'a missing LIVE widget on a matching page is not classified as an own-write (clones do not count)'
  );
  check(/setInterval\(function \(\) \{[\s\S]*?scheduleCheck\(\);[\s\S]*?\}, 2000\)/.test(src), 'polls to re-inject if Vue stripped the panel');
  check(src.includes('document.body.insertBefore'), 'falls back to document.body if the grid is not mounted yet');
}

console.log('\n--- Widget clicks: document capture so Vue clones are not dead buttons ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.css'), 'utf8');
  check(
    src.includes("document.addEventListener('click', onDocWidgetClick, true)"),
    'clicks bind on document capture (Vue clones drop per-node listeners)'
  );
  check(
    src.includes("document.addEventListener('change', onDocWidgetChange, true)"),
    'checkbox change binds on document capture'
  );
  check(/function sweepCloneWidgets\(/.test(src), 'sweepCloneWidgets drops Vue lookalikes that share the widget id');
  check(/function runWidgetAction\(/.test(src), 'actions are dispatched from the delegated handler, not per-node bindEvents');
  check(!/function bindEvents\(/.test(src), 'per-node bindEvents is gone — it is what Vue clones leave behind');
  check(
    src.includes('isNativeTickTarget') && /if \(isNativeTickTarget\(t\)\) return;/.test(src),
    'checkbox / row-label clicks are not preventDefaulted (native tick must happen)'
  );
  check(
    /el\.innerHTML = buildHtml\(\);/.test(src) && !/bindEvents\(el\)/.test(src) && !/bindEvents\(w\)/.test(src),
    'render/inject do not re-attach per-node listeners after innerHTML'
  );
  check(/pointer-events:\s*auto/.test(css), 'widget CSS keeps pointer-events so the grid cannot eat clicks');
  check(/z-index:\s*20/.test(css), 'widget CSS stacks above overlapping AG-Grid chrome');
}

console.log('\n--- Open panel stays in the viewport (Review/Confirm not below the fold) ---');
{
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.css'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-bulk-action.js'), 'utf8');
  check(/function capOpenPanel\(/.test(src), 'capOpenPanel measures remaining viewport');
  check(/body\.style\.height = max/.test(src), 'a long list gets an explicit height so the footer is not clipped');
  check(/ms-tba-footer/.test(src) && /\.ms-tba-footer \{/.test(css), 'Review/Confirm live in a footer outside the scrolling list');
  check(/Review and /.test(src) && /config\.verb\.toLowerCase\(\)/.test(src), 'the mass-action button names the verb (acknowledge / discard)');
  check(/\.ms-tba-scroll \{[\s\S]*?overflow-y: auto/.test(css), 'the row list scrolls, not the whole page');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed === 0 ? 0 : 1);
