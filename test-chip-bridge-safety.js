// Medicus Suite — Triage Lens escape + task-list bridge, and Record sender check
// Run with: node test-chip-bridge-safety.js
//
// content.js is a content-script IIFE. This test require()s the file (so a
// coverage run that loads tests also loads content.js) and calls the escaping
// and bridge-validation functions the file exports for Node. The export branch
// runs only when CommonJS `module` exists; Chrome content scripts do not have
// it, so the extension bootstrap is unchanged.

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

global.window = {
  addEventListener() {},
  removeEventListener() {},
  PendingResultIndex: null,
};
global.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  createElement() {
    return {};
  },
};
global.location = { href: 'https://example.test/queue' };

const content = require('./content-scripts/triage-lens/content.js');
const {
  escapeHtml,
  renderChipHtml,
  validateTaskListDetail,
  bridgeEventAllowed,
  BRIDGE_MAX_ROWS,
  BRIDGE_MAX_EVENTS_PER_WINDOW,
} = content;

console.log('--- content.js loaded ---');
check(typeof escapeHtml === 'function', 'escapeHtml loaded from content.js');
check(typeof renderChipHtml === 'function', 'renderChipHtml loaded from content.js');
check(typeof validateTaskListDetail === 'function', 'validateTaskListDetail loaded from content.js');
check(typeof bridgeEventAllowed === 'function', 'bridgeEventAllowed loaded from content.js');
check(BRIDGE_MAX_ROWS === 500, 'bridge row cap is 500');
check(BRIDGE_MAX_EVENTS_PER_WINDOW === 10, 'bridge rate limit is 10 events per window');

const contentSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
const listener = contentSrc.match(/window\.addEventListener\('ch-task-list-data',[\s\S]*?\n  \}\);/);
check(!!listener, 'ch-task-list-data listener still present');
check(!!listener && listener[0].includes('bridgeEventAllowed('), 'listener uses bridgeEventAllowed');
check(!!listener && listener[0].includes('validateTaskListDetail('), 'listener uses validateTaskListDetail');
check(
  contentSrc.includes("if (typeof module !== 'undefined' && module.exports)"),
  'node export is gated on CommonJS module'
);

console.log('\n--- escapeHtml / renderChipHtml ---');
check(escapeHtml('Ada Example') === 'Ada Example', 'plain text is unchanged');
check(escapeHtml('a&b<c>d"e\'f') === 'a&amp;b&lt;c&gt;d&quot;e&#39;f', 'escapes & < > " \'');
check(escapeHtml(null) === 'null', 'null is stringified, not thrown');
check(!escapeHtml('<img src=x onerror=alert(1)>').includes('<'), 'a patient-name payload cannot contain a raw <');
{
  const html = renderChipHtml({
    kind: 'red"><script>',
    text: '<script>alert(1)</script>',
    ruleId: 'rule" onclick="alert(1)',
    hasActions: false,
  });
  check(!html.includes('<script>'), 'chip text is escaped');
  check(html.includes('data-rule-id="rule&quot; onclick=&quot;alert(1)"'), 'rule id quotes are escaped so the attribute does not close');
  check(html.includes('&lt;script&gt;'), 'chip text is escaped as text');
  check(html.includes('ch-chip-red&quot;&gt;&lt;script&gt;'), 'chip kind is escaped inside the class');
}

console.log('\n--- task-list bridge shape, cap, rate limit ---');
check(validateTaskListDetail(null) === null, 'missing detail is refused');
check(validateTaskListDetail({}) === null, 'empty detail is refused');
check(validateTaskListDetail({ rows: {}, taskTypeSlug: 'medical_patient_request_task' }) === null, 'non-array rows are refused');
check(validateTaskListDetail({ rows: [], taskTypeSlug: 12 }) === null, 'non-string slug is refused');
check(validateTaskListDetail({ rows: [], taskTypeSlug: 'has space' }) === null, 'slug with a space is refused');
check(validateTaskListDetail({ rows: [], taskTypeSlug: 'a'.repeat(81) }) === null, 'over-long slug is refused');

function uuid(n) {
  return 'aaaaaaaa-bbbb-4ccc-8ddd-' + n.toString(16).padStart(12, '0');
}
const goodSlug = 'medical_patient_request_task';
const goodOverview = '/tasks/data/medical_patient_request_task/overview/' + uuid(1);

{
  const parsed = validateTaskListDetail({
    taskTypeSlug: goodSlug,
    rows: [
      { rowIndex: 0, taskUuid: uuid(1), overviewURL: goodOverview, priorityDisplay: 'Urgent', unmatched: 1 },
      { rowIndex: 1.5, taskUuid: uuid(2) },
      { rowIndex: -1, taskUuid: uuid(3) },
      { rowIndex: 2, taskUuid: 'not-a-uuid' },
      null,
      { rowIndex: 3, taskUuid: uuid(4), overviewURL: 'https://evil.example/overview', priorityDisplay: 'x'.repeat(80) },
    ],
  });
  check(parsed && parsed.accepted.length === 2, 'only well-shaped rows are accepted');
  check(parsed.accepted[0].taskUuid === uuid(1), 'valid uuid kept');
  check(parsed.accepted[0].overviewURL === goodOverview, 'relative overview URL kept');
  check(parsed.accepted[0].unmatched === true, 'unmatched is coerced to boolean');
  check(parsed.accepted[0].rowTaskTypeSlug === goodSlug, 'row slug comes from the overview URL');
  check(parsed.accepted[1].overviewURL === '', 'absolute overview URL is dropped');
  check(parsed.accepted[1].priorityDisplay.length === 40, 'priority display is capped at 40 characters');
  check(parsed.taskTypeSlug === goodSlug, 'queue slug is returned');
}

{
  const rows = [];
  for (let i = 0; i < 501; i++) rows.push({ rowIndex: i, taskUuid: uuid(i + 1) });
  const parsed = validateTaskListDetail({ taskTypeSlug: goodSlug, rows });
  check(parsed.accepted.length === 500, 'a 501-row payload is capped at 500');
  check(parsed.accepted[0].rowIndex === 0, 'cap keeps the first row');
  check(parsed.accepted[499].rowIndex === 499, 'cap drops the 501st row');
}

check(bridgeEventAllowed(1) === true, 'first event in the window is allowed');
check(bridgeEventAllowed(10) === true, '10th event in the window is allowed');
check(bridgeEventAllowed(11) === false, '11th event in the window is refused');

console.log('\n--- record.js sender check ---');
const recordSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'record', 'record.js'), 'utf8');
const recordListener = recordSrc.match(/_onRuntimeMsg = (\(msg, sender\) => \{[\s\S]*?\n  \});/);
check(!!recordListener, 'record snapshot listener takes sender');
check(
  !!recordListener && /sender\.id !== chrome\.runtime\.id/.test(recordListener[0]),
  'listener compares sender.id with chrome.runtime.id before load()'
);
check(
  !!recordListener && recordListener[0].indexOf('sender.id') < recordListener[0].indexOf('load()'),
  'the sender check is before load()'
);

if (recordListener) {
  const sandbox = {
    chrome: { runtime: { id: 'medicus-suite-test' } },
    loads: 0,
    load() {
      sandbox.loads++;
    },
  };
  vm.runInNewContext('this.fn = ' + recordListener[1] + ';', sandbox);
  sandbox.fn({ type: 'sentinel:snapshot-updated' }, { id: 'some-other-extension' });
  check(sandbox.loads === 0, 'a foreign sender does not reload Record');
  sandbox.fn({ type: 'sentinel:snapshot-updated' }, null);
  check(sandbox.loads === 0, 'a missing sender does not reload Record');
  sandbox.fn({ type: 'sentinel:snapshot-updated' });
  check(sandbox.loads === 0, 'a call with no sender does not reload Record');
  sandbox.fn({ type: 'other' }, { id: 'medicus-suite-test' });
  check(sandbox.loads === 0, 'a different message from this extension does not reload Record');
  sandbox.fn({ type: 'sentinel:snapshot-updated' }, { id: 'medicus-suite-test' });
  check(sandbox.loads === 1, 'this extension snapshot reloads Record');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
