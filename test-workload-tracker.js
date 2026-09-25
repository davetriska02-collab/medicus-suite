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
      nhsNumber: '9999999999',
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
check(/\[MSWL\] loaded',\s*\{\s*staff:/.test(src), 'debug log is counts only');
check(!/console\.(log|info|warn|debug)\([^)]*label/.test(src), 'logs do not include a label');
check(/ms-wl-theme-dark/.test(css) && /data-colorblind/.test(css), 'dark and colour-blind selectors exist');
check(
  /var\(--red\)/.test(css) && /var\(--cat-2\)/.test(css) && /var\(--amber\)/.test(css),
  'status and category tokens are used'
);
check(!/#mwt-/.test(css) && !/\.mwt-/.test(src), 'old extension ids are gone');

console.log('\n--- hazard id is H-084 ---');
const hazard = fs.readFileSync(path.join(__dirname, 'docs/HAZARD-LOG.md'), 'utf8');
const notice = fs.readFileSync(path.join(__dirname, 'docs/CLINICAL-SAFETY-NOTICE.md'), 'utf8');
const changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
const ledger = fs.readFileSync(path.join(__dirname, 'docs/cso-review-ledger.json'), 'utf8');
check(/### H-084 — Workload counts/.test(hazard), 'hazard log heading is H-084');
check(!/H-083/.test(hazard), 'hazard log does not keep H-083 for this pack');
check(/H-084 Workload tracker/.test(notice), 'clinical safety notice names H-084');
check(!/H-083/.test(notice), 'clinical safety notice does not keep H-083');
check(/H-084 is proposed and not signed off/.test(changelog), 'changelog names H-084');
check(/H-084 Workload tracker/.test(ledger), 'review ledger names H-084');
check(!/H-083/.test(ledger), 'review ledger does not keep H-083');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
