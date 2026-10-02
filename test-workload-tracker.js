// Medicus Suite — Workload tracker (parse, sort, search, pack, theme, poll)
// Run with: node test-workload-tracker.js
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('./shared/workload-tracker-core.js');
const Packs = require('./shared/practice-packs.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

const payload = {
  patientId: 'must-not-survive',
  tasksByStaffMember: [
    {
      label: 'Dr Ann Lee',
      overdueHighPriority: 2,
      allHighPriority: 4,
      allNormalPriority: 1,
      snoozed: 0,
      patientName: 'Secret Patient',
      nhsNumber: '9999999990',
    },
    { label: 'Jo Smith', overdueHighPriority: 0, allHighPriority: 8, allNormalPriority: 3, snoozed: 1 },
    {
      label: 'Sam Patel',
      overdueHighPriority: 0,
      allHighPriority: 1,
      allNormalPriority: 0,
      snoozed: 0,
      sortValue: 'Patel, Sam',
    },
    { label: '   ', overdueHighPriority: 9 },
    { label: 12, allHighPriority: 4 },
    { overdueHighPriority: 3 },
  ],
  tasksByTeam: [{ label: 'Nursing', overdueHighPriority: 1, allHighPriority: 2, allNormalPriority: 5, snoozed: 2 }],
};

console.log('--- parse and drop anything that is not a count ---');
const parsed = Core.parseDashboard(payload);
check(parsed.staff.length === 3, 'blank and non-string labels are dropped');
check(parsed.teams.length === 1, 'team row kept');
check(!Object.prototype.hasOwnProperty.call(parsed.staff[0], 'patientName'), 'patient name is not kept');
check(!Object.prototype.hasOwnProperty.call(parsed.staff[0], 'nhsNumber'), 'NHS number is not kept');
check(parsed.patientId === undefined, 'payload-level patient id is not kept');
check(parsed.staff[0].overdueHighPriority === 2, 'overdue count kept');
check(
  Core.parseDashboard({ data: { tasksByStaffMember: [{ label: 'Ada', allHighPriority: 1.9 }] } }).staff[0]
    .allHighPriority === 1,
  'wrapped payload and fractional counts floor'
);
check(Core.parseDashboard(null).staff.length === 0, 'null payload is an empty staff list');
check(
  Core.normaliseMember({ label: 'Ada', allHighPriority: -4, snoozed: 'nope' }).allHighPriority === 0,
  'negative count becomes 0'
);
check(Core.normaliseMember({ label: 'Ada', snoozed: 'nope' }).snoozed === 0, 'non-numeric count becomes 0');

console.log('\n--- totals, summary, tone ---');
const ann = parsed.staff[0];
const jo = parsed.staff[1];
const sam = parsed.staff[2];
check(Core.totalLoad(ann) === 5, 'overdue is not added on top of high priority');
check(Core.totalLoad(jo) === 12, 'snoozed counts in the total');
const summary = Core.summarise(parsed.staff);
check(
  summary.overdue === 2 && summary.high === 13 && summary.normal === 4 && summary.snoozed === 1,
  'summary adds the view'
);
check(summary.members === 3, 'summary member count is the row count');
check(Core.cardTone(ann) === 'overdue', 'any overdue marks the card overdue');
check(Core.cardTone(jo) === 'heavy', 'high priority above 5 with no overdue is heavy');
check(Core.cardTone(sam) === '', 'a light row has no tone');
check(Core.initials('Dr Ann Lee') === 'AL', 'Dr is skipped for initials');
check(Core.initials('Nursing') === 'NU', 'one-word label uses two letters');
check(Core.barPercent(1, 8) === 13, 'bar width rounds and stays at least 2 when non-zero');
check(Core.barPercent(0, 8) === 0, 'zero value has no bar');
const bars = Core.barRows(jo, Core.barScale(parsed.staff));
check(bars.map((b) => b.key).join(',') === 'high,normal,snoozed', 'zero overdue is omitted from the bars');

console.log('\n--- sort and search ---');
const byTotal = Core.sortMembers(parsed.staff, 'total').map((r) => r.label);
check(byTotal.join('|') === 'Jo Smith|Dr Ann Lee|Sam Patel', 'total sort is heaviest first');
const byOverdue = Core.sortMembers(parsed.staff, 'overdue').map((r) => r.label);
check(byOverdue[0] === 'Dr Ann Lee', 'overdue sort puts overdue first');
check(byOverdue[1] === 'Jo Smith', 'overdue ties fall through to total');
const byName = Core.sortMembers(parsed.staff, 'name').map((r) => r.sortValue);
check(byName.join('|') === 'Dr Ann Lee|Jo Smith|Patel, Sam', 'name sort uses sortValue');
const found = Core.filterMembers(parsed.staff, '  ANN ');
check(found.length === 1 && found[0].label === 'Dr Ann Lee', 'search is trimmed and case-insensitive');
check(Core.filterMembers(parsed.staff, '').length === 3, 'empty search keeps everyone');
const viewed = Core.prepareView(parsed, 'staff', 'ann', 'total');
check(viewed.members.length === 1, 'prepareView filters the list');
check(viewed.summary.members === 3, 'summary stays on the whole view while searching');
check(Core.prepareView(parsed, 'team', '', 'total').members[0].label === 'Nursing', 'team view reads tasksByTeam');

console.log('\n--- host, dashboard path, poll floor ---');
check(
  Core.resolveApiBase({ hostname: 'england.medicus.health', pathname: '/560b6c/tasks/dashboard' }) ===
    'https://560b6c.api.england.medicus.health',
  'api base is {site}.api.{page hostname}'
);
check(
  Core.resolveApiBase({ hostname: 'staging.medicus.health', pathname: '/560b6c/tasks/dashboard' }) ===
    'https://560b6c.api.staging.medicus.health',
  'a different Medicus host is not rewritten to england'
);
check(
  Core.resolveApiBase({ hostname: 'example.com', pathname: '/560b6c/tasks/dashboard' }) === '',
  'non-Medicus host is refused'
);
check(
  Core.resolveApiBase({ hostname: 'england.medicus.health', pathname: '/not-a-site/tasks/dashboard' }) === '',
  'site id must be hex'
);
check(
  Core.resolveApiBase({ hostname: '560b6c.api.staging.medicus.health', pathname: '/tasks/dashboard' }) ===
    'https://560b6c.api.staging.medicus.health',
  'an existing api host is used as-is'
);
const url = Core.dashboardDataUrl(
  Core.resolveApiBase({ hostname: 'staging.medicus.health', pathname: '/ab12/tasks/dashboard' })
);
check(
  url === 'https://ab12.api.staging.medicus.health/tasks/data/dashboard-data',
  'dashboard URL stays on the practice API host'
);
check(Core.dashboardDataUrl('https://staging.medicus.health') === '', 'the page host is not fetched');
check(Core.isDashboardPath('/560b6c/tasks/dashboard') === true, 'dashboard path matches');
check(Core.isDashboardPath('/560b6c/tasks/dashboard/today') === true, 'dashboard subpath matches');
check(Core.isDashboardPath('/560b6c/tasks/dashboards') === false, 'a longer word is not the dashboard');
check(Core.REFRESH_MS === 5 * 60 * 1000, 'recurring refresh is 5 minutes');
check(Core.MIN_REFRESH_MS === 2 * 60 * 1000, 'refresh floor is 2 minutes');
check(Core.clampRefreshMs(90000) === Core.MIN_REFRESH_MS, 'the old 90 second timer is clamped');
check(Core.shouldPoll({ packOn: true, panelOpen: true, hidden: false }) === true, 'open visible panel may poll');
check(Core.shouldPoll({ packOn: true, panelOpen: true, hidden: true }) === false, 'a hidden tab does not poll');
check(Core.shouldPoll({ packOn: true, panelOpen: false, hidden: false }) === false, 'a closed panel does not poll');
check(Core.shouldPoll({ packOn: false, panelOpen: true, hidden: false }) === false, 'pack off does not poll');

console.log('\n--- theme class and pack gate ---');
check(
  Core.themeClassName({}) === 'ms-wl ms-wl-theme-light ms-wl-size-medium',
  'missing prefs are light, medium, not colour-blind'
);
check(
  Core.themeClassName({ theme: 'dark', colorblind: true, size: 'large' }) ===
    'ms-wl ms-wl-theme-dark ms-wl-size-large ms-wl-colorblind',
  'dark, large, and colour-blind classes are applied'
);
check(Core.themeDataset({ theme: 'sepia' }).theme === 'light', 'an unknown theme stays light');
check(Core.themeDataset({ colorblind: 'true' }).colorblind === 'true', 'string true still marks colour-blind');
check(Packs.KEYS.workloadTracker === 'suite.ui.workloadTracker', 'pack key');
check(Packs.isGrandfather(Packs.KEYS.workloadTracker) === true, 'workload tracker is default-on');
check(Packs.isEnabled(Packs.KEYS.workloadTracker, undefined) === true, 'missing key means on');
check(Packs.isEnabled(Packs.KEYS.workloadTracker, false) === false, 'explicit false stays off');
check(Packs.isEnabled(Packs.KEYS.workloadTracker, true) === true, 'explicit true stays on');

console.log('\n--- content script is read-only and uses the suite hooks ---');
const src = fs.readFileSync(path.join(__dirname, 'content-scripts/workload-tracker.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'content-scripts/workload-tracker.css'), 'utf8');
check(/method:\s*'GET'/.test(src), 'fetch is GET');
check(/credentials:\s*'include'/.test(src), 'fetch uses the page session');
check(!/\b(POST|PUT|PATCH|DELETE)\b/.test(src), 'no write method');
check(!/innerHTML/.test(src), 'names are not written with innerHTML');
check(!/england\.medicus\.health/.test(src), 'content script does not hard-code the england host');
check(/dashboardDataUrl/.test(src) && /resolveApiBase/.test(src), 'content script uses the practice API host helper');
check(/REFRESH_MS/.test(src) && !/90000/.test(src), 'timer uses the suite refresh constant');
check(/document\.hidden/.test(src) && /visibilitychange/.test(src), 'polling pauses while the tab is hidden');
check(/bindInjector/.test(src) && /suite\.ui\.workloadTracker/.test(src), 'pack gate is wired');
check(/InjectorRuntime/.test(src) && /muteWorkloadChrome/.test(src), 'route runtime can tear the panel down');
check(/themeClassName/.test(src), 'theme class is applied from display prefs');
check(/taskListUrl/.test(src) && /readTaskList/.test(src), 'type counts use the task-list helper');
check(/createdAt_startDate/.test(src) === false, 'the content script does not build the date query itself');
check(!/patientName/.test(src) && !/nhsNumber/.test(src), 'the content script does not read patient fields');
check(/typeNote/.test(src) && /This is not zero/.test(src), 'a dash is labelled as not zero');
check(/ms-wl-type-grid/.test(css) && /tabular-nums/.test(css), 'type counts use a grid and tabular figures');
check(/var\(--cat-1\)/.test(css) && /var\(--cat-3\)/.test(css) && /var\(--cat-6\)/.test(css), 'type colours use the category ramp');
check(/\[MSWL\] loaded',\s*\{\s*staff:/.test(src), 'debug log is counts only');
check(!/console\.(log|info|warn|debug)\([^)]*label/.test(src), 'logs do not include a label');
check(/ms-wl-theme-dark/.test(css) && /data-colorblind/.test(css), 'dark and colour-blind selectors exist');
check(
  /var\(--red\)/.test(css) && /var\(--cat-2\)/.test(css) && /var\(--amber\)/.test(css),
  'status and category tokens are used'
);
check(!/#mwt-/.test(css) && !/\.mwt-/.test(src), 'old extension ids are gone');

console.log('\n--- task types from the queues Suite already reads ---');
const typeSlugs = Core.TASK_TYPES.map((t) => t.slug);
check(
  typeSlugs.join('|') ===
    [
      'medical_patient_request_task',
      'admin_patient_request_task',
      'review_investigation_results_task',
      'prescription_request_task_routine',
      'prescription_request_task_non_routine',
      'review_inbound_document_task',
    ].join('|'),
  'the six open queues are medical, admin, results, both prescription lists, and inbound documents'
);
check(
  !typeSlugs.some((slug) => /privacy|eps|consultation|medicationReviews/i.test(slug)),
  'consultations, medication reviews, privacy-officer and EPS lists are not added'
);
const typeBase = 'https://ab12.api.staging.medicus.health';
check(
  Core.taskListUrl(typeBase, 'medical_patient_request_task', null) ===
    typeBase + '/tasks/data/medical_patient_request_task/task-list',
  'an open period has no date query'
);
check(Core.taskListUrl(typeBase, 'not_a_real_queue', null) === '', 'an unknown queue is not requested');
check(
  Core.taskListUrl(typeBase, 'admin_patient_request_task', { start: '2026-10-02', end: '2026-10-01' }) === '',
  'an inverted window is not requested'
);
check(Core.taskListUrl('https://staging.medicus.health', 'admin_patient_request_task', null) === '', 'the page host is not fetched');
const ranged = Core.taskListUrl(typeBase, 'review_inbound_document_task', {
  start: '2026-10-01',
  end: '2026-10-02',
});
check(/createdAt_startDate=2026-10-01/.test(ranged), 'the date filter uses createdAt_startDate');
check(/createdAt_endDate=2026-10-02/.test(ranged), 'the date filter uses createdAt_endDate');
check(!/[?&]startDate=/.test(ranged), 'the bare startDate parameter is not sent');
const week = Core.periodRange('last7', new Date(2026, 9, 2, 15, 30, 0));
check(week.start === '2026-09-26' && week.end === '2026-10-02', 'last 7 days includes today');
check(Core.periodRange('today', new Date(2026, 9, 2, 15, 30, 0)).start === '2026-10-02', 'today is one day');
check(Core.periodRange('open', new Date(2026, 9, 2)) === null, 'open now is the whole list');
check(Core.periodRange('nope', new Date(2026, 9, 2)) === null, 'an unknown period is not a made-up window');
check(Core.taskCreatedISO('02 Oct 2026 09:15') === '2026-10-02', 'legacy createdAt dates are read');

console.log('\n--- counts per type per person, patient fields dropped ---');
const windowRange = { start: '2026-10-01', end: '2026-10-02' };
const medicalList = Core.readTaskList(
  {
    totalCount: 8,
    tasks: [
      {
        assignedTo: 'Clinician A',
        patientName: 'Secret Patient',
        nhsNumber: '9999999990',
        id: 'task-1',
        summary: 'hidden summary',
        createdAt: '2026-10-02T09:00:00Z',
      },
      {
        assignedTo: { name: 'Clinician A', id: 'drop-this-id' },
        patientName: 'Other Patient',
        createdAt: '2026-10-01T08:00:00Z',
      },
      { assignedTo: 'clinician b', patientName: 'Third Patient', createdAt: '2026-10-02T10:00:00Z' },
      { assignedTo: 'Clinician C', patientName: 'Fourth Patient', createdAt: '2026-10-02' },
      { assignedTo: '', patientName: 'Fifth Patient', createdAt: '2026-10-02' },
      { assignedTo: 'Team A', patientName: 'Sixth Patient', createdAt: '2026-10-02' },
      { assignedTo: 'Clinician A', patientName: 'Old Patient', createdAt: '2026-01-01T00:00:00Z' },
    ],
  },
  windowRange
);
const medicalJson = JSON.stringify(medicalList);
check(medicalJson.indexOf('Secret Patient') === -1, 'patient name is not kept on the tally');
check(medicalJson.indexOf('9999999990') === -1, 'NHS number is not kept on the tally');
check(medicalJson.indexOf('hidden summary') === -1, 'task summary is not kept on the tally');
check(medicalJson.indexOf('drop-this-id') === -1, 'assignee id is not kept on the tally');
check(medicalJson.indexOf('task-1') === -1, 'task id is not kept on the tally');
check(medicalList.filterIgnored === true, 'a date outside the window means the filter was ignored');
check(medicalList.truncated === true, 'a short page is marked truncated');
check(medicalList.counted === 6, 'the January task is not counted in the window');
check(medicalList.byKey['clinician a'].count === 2, 'two open tasks for Clinician A in the window');
const typed = Core.parseDashboard({
  tasksByStaffMember: [
    { label: 'Clinician A', allHighPriority: 4, allNormalPriority: 1, snoozed: 0 },
    { label: 'Clinician B', allHighPriority: 1, allNormalPriority: 0, snoozed: 0 },
  ],
  tasksByTeam: [{ label: 'Team A', allHighPriority: 3, allNormalPriority: 1, snoozed: 0 }],
});
const typeReport = {
  medical: medicalList,
  admin: { ok: true, byKey: {} },
  results: { ok: false, status: 503 },
  rxRoutine: { ok: true, byKey: {} },
  rxNonRoutine: { ok: true, byKey: {} },
  documents: {
    ok: true,
    byKey: { 'clinician a': { label: 'Clinician A', count: 3 } },
    filterIgnored: false,
    truncated: false,
  },
};
const staffView = Core.prepareView(typed, 'staff', '', 'type:medical', typeReport);
check(staffView.summary.high === 5 && staffView.summary.members === 2, 'dashboard totals ignore the type rows');
check(staffView.types.medical === 5, 'staff type total is A, B, C and unassigned, not the team');
check(staffView.types.admin === 0, 'a loaded empty queue is zero');
check(staffView.types.results === null, 'a queue that did not load is not zero');
check(staffView.types.documents === 3, 'document tasks stay on the matching person');
const byLabel = {};
staffView.members.forEach((row) => {
  byLabel[row.label] = row;
});
check(byLabel['Clinician A'].byType.medical === 2, 'Clinician A keeps their medical count after sorting');
check(byLabel['Clinician A'].byType.documents === 3, 'Clinician A keeps their document count on the same row');
check(byLabel['Clinician B'].byType.medical === 1, 'assignee match is case-insensitive and stays on that person');
check(byLabel['Clinician B'].byType.admin === 0, 'a person with no admin tasks shows zero when that queue loaded');
check(byLabel['Clinician B'].byType.results === null, 'the failed queue stays blank on the person');
check(byLabel['Clinician C'].fromDashboard === false, 'a person missing from the dashboard is still listed');
check(byLabel['Unassigned'].byType.medical === 1, 'tasks with no assignee are counted');
check(!byLabel['Team A'], 'a team inbox is not listed as a person');
check(
  staffView.members.map((row) => row.label).join('|') === 'Clinician A|Clinician B|Clinician C|Unassigned',
  'type sort is numeric, heaviest first, and a tie breaks by name'
);
const nameOrder = Core.sortMembers(staffView.members, 'name').map((row) => row.label + ':' + row.byType.medical);
check(
  nameOrder.join('|') === 'Clinician A:2|Clinician B:1|Clinician C:1|Unassigned:1',
  'name sort does not detach a count from its person'
);
const missingLast = Core.sortMembers(
  [
    { label: 'Clinician A', sortValue: 'Clinician A', byType: { medical: null } },
    { label: 'Clinician B', sortValue: 'Clinician B', byType: { medical: 0 } },
  ],
  'type:medical'
).map((row) => row.label);
check(missingLast.join('|') === 'Clinician B|Clinician A', 'a missing type count sorts after a real zero');
const teamView = Core.prepareView(typed, 'team', '', 'total', typeReport);
check(teamView.members[0].label === 'Team A' && teamView.members[0].byType.medical === 1, 'team view counts that inbox');
check(teamView.summary.members === 1, 'team summary stays the dashboard team count');
check(/not a split of the totals/.test(Core.typeNote(staffView.flags)), 'the note says type counts are not the dashboard split');
check(/Results did not load/.test(Core.typeNote(staffView.flags)), 'a failed queue is named');
check(/A dash is not zero/.test(Core.typeNote(staffView.flags)), 'a dash is described as not zero');
check(Core.typeNote({ failed: [], ignored: [], truncated: [], pending: true }).indexOf('did not load') === -1, 'a pending read is not called a failure');
const cells = Core.typeCells(byLabel['Clinician B']);
check(cells.find((cell) => cell.key === 'results').loaded === false, 'a cell for a failed queue is not loaded');
check(cells.find((cell) => cell.key === 'admin').value === 0, 'a cell for an empty queue is zero');

console.log('\n--- hazard id is H-084 ---');
const hazard = fs.readFileSync(path.join(__dirname, 'docs/HAZARD-LOG.md'), 'utf8');
const notice = fs.readFileSync(path.join(__dirname, 'docs/CLINICAL-SAFETY-NOTICE.md'), 'utf8');
const changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
const ledger = fs.readFileSync(path.join(__dirname, 'docs/cso-review-ledger.json'), 'utf8');
check(/### H-084 — Workload counts/.test(hazard), 'hazard log heading is H-084');
check(!/H-083/.test(hazard), 'hazard log does not keep H-083 for this pack');
check(/H-084 Workload tracker/.test(notice), 'clinical safety notice names H-084');
check(!/H-083/.test(notice), 'clinical safety notice does not keep H-083');
check(/H-084 is accepted \(ALARP\)/.test(changelog), 'changelog records the H-084 sign-off');
check(/H-084 Workload tracker/.test(ledger), 'review ledger names H-084');
check(!/H-083/.test(ledger), 'review ledger does not keep H-083');
const h097 = hazard.split('### H-097')[1] ? hazard.split('### H-097')[1].split('## 6. Hazard summary')[0] : '';
check(/### H-097 — /.test(hazard), 'hazard log records H-097');
check(/Accepted \(ALARP\)/.test(h097), 'H-097 is accepted');
check(/Signed: Dr D\. Triska \(CSO, GMC 6159481\), 2026-10-02/.test(h097), 'H-097 is signed');
check(/this sign-off is v3\.100/.test(h097), 'H-097 sign-off is hazard-log v3.100');
check(/doc v3\.108/.test(h097), 'H-097 is aligned with the clinical safety notice');
check(/H-097 is Accepted \(ALARP\)/.test(changelog), 'changelog records the H-097 sign-off');
check(/3\.268\.17/.test(changelog), 'changelog records 3.268.17');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
