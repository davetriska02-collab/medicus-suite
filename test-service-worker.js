// Medicus Suite — Service Worker tests
// Run with: node test-service-worker.js
//
// Combines two approaches used throughout this test suite:
//   (a) vm-extraction: pure/pure-ish helpers are pulled from service-worker.js
//       and exercised in a sandbox with a minimal stub `chrome` object.
//   (b) source-level invariants: regex assertions over the raw source lock
//       security and robustness properties that cannot be safely refactored away.

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else       { console.error(`  FAIL  ${msg}`); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');

(async () => {

// ── Source-level invariants ───────────────────────────────────────────────────

console.log('\n--- importScripts: every call is wrapped in try/catch with console.warn ---');

// Collect every importScripts() call site in the source.
// We verify that none appears "naked" (outside a try block) and that every
// catch block contains a console.warn call.
//
// Strategy: extract each try { importScripts(...) } catch (e) { ... } block
// and confirm the catch always console.warns. We also assert there are no
// importScripts( lines that fall outside a try block.

const importScriptsLines = (src.match(/importScripts\([^)]+\)/g) || []).length;
check(importScriptsLines > 0, `importScripts is called at least once (found ${importScriptsLines})`);

// The first block wraps multiple calls in a single try with console.warn in catch
const multiImportTryBlock = src.match(/try\s*\{([\s\S]*?importScripts[\s\S]*?)\}\s*catch\s*\(e\)\s*\{\s*\n\s*console\.warn/);
check(!!multiImportTryBlock, 'multi-importScripts block is try/caught with console.warn');

// All individual importScripts (one per try) catch blocks should console.warn
const individualBlocks = src.match(/try\s*\{\s*importScripts\([^)]+\);\s*\}\s*catch\s*\(e\)\s*\{[^}]+\}/g) || [];
const allWarn = individualBlocks.every(block => /console\.warn/.test(block));
check(individualBlocks.length > 0 && allWarn,
  `all ${individualBlocks.length} individual importScripts blocks have console.warn in catch`);

// Confirm there are no importScripts calls outside a try block.
// We do this by removing all try{...}catch{...} blocks and checking nothing remains.
const stripped = src.replace(/try\s*\{[^{}]*importScripts[^{}]*\}\s*catch\s*\([^)]+\)\s*\{[^}]+\}/g, '');
check(!stripped.includes('importScripts('),
  'no importScripts call exists outside a try/catch block');

console.log('\n--- sender identity guard in onMessage --------------------------------');

// The guard `sender.id !== chrome.runtime.id` must exist inside the
// onMessage handler to reject cross-extension / web-page injection.
const onMessageBlock = src.match(
  /chrome\.runtime\.onMessage\.addListener\(\s*\(msg,\s*sender[\s\S]*?\}\s*\)\s*;/
);
check(!!onMessageBlock, 'chrome.runtime.onMessage.addListener block found');
check(
  onMessageBlock && /sender\.id\s*!==\s*chrome\.runtime\.id/.test(onMessageBlock[0]),
  'onMessage handler guards against external senders with sender.id !== chrome.runtime.id'
);

console.log('\n--- notifMap cap: slice(-50) is present in sendRmNotifications --------');

// Guards unbounded notification-state growth: the persisted map must be
// capped so a long-running worker cannot accumulate thousands of entries.
const sendRmNotifFn = src.match(
  /async function sendRmNotifications\([\s\S]*?\n\}/
);
check(!!sendRmNotifFn, 'sendRmNotifications function found in source');
check(
  sendRmNotifFn && /\.slice\(-50\)/.test(sendRmNotifFn[0]),
  'sendRmNotifications caps notifMap with .slice(-50)'
);

// Make sure the cap is applied to the full entries list before storing
check(
  sendRmNotifFn && /Object\.fromEntries\(entries\.slice\(-50\)\)/.test(sendRmNotifFn[0]),
  'Object.fromEntries(entries.slice(-50)) pattern confirms capped result is re-serialised'
);

console.log('\n--- alarm names: every chrome.alarms.create name has a matching onAlarm handler ---');

// All alarm names in this worker are passed via string constants (e.g. SLOTS_ALARM).
// Strategy:
//   1. Build a map of constant-name → string-value from `const X = 'value'` lines.
//   2. Find every chrome.alarms.create(CONST, ...) call and resolve CONST.
//   3. Check each resolved name has a handler in some onAlarm listener via
//      `alarm.name === CONST` (using the same constant).

// Step 1: resolve all top-level string constants
const constMap = {};
for (const m of src.matchAll(/^const\s+(\w+)\s*=\s*'([^']+)'/gm)) {
  constMap[m[1]] = m[2];
}

// Step 2: find alarms.create calls — the first arg is always a constant here
const alarmCreateConsts = [...src.matchAll(/chrome\.alarms\.create\(\s*(\w+)\s*,/g)]
  .map(m => m[1]);

// Step 3: find onAlarm handler checks — `alarm.name === CONST`
const alarmHandledConsts = new Set(
  [...src.matchAll(/alarm\.name\s*===\s*(\w+)/g)].map(m => m[1])
);

check(alarmCreateConsts.length >= 3,
  `at least 3 alarms are registered via constants (found: ${alarmCreateConsts.join(', ')})`);

for (const constName of alarmCreateConsts) {
  const resolvedValue = constMap[constName] || '(unresolved)';
  check(
    alarmHandledConsts.has(constName),
    `alarm constant ${constName} ("${resolvedValue}") has a matching alarm.name === ${constName} handler`
  );
}

console.log('\n--- version regex: _VERSION_RE validates semver strings correctly ------');

// Extract _VERSION_RE from source so we can test it in-process.
const versionReMatch = src.match(/const _VERSION_RE\s*=\s*(\/[^\n]+\/)/);
check(!!versionReMatch, '_VERSION_RE constant found in source');

let VERSION_RE = null;
if (versionReMatch) {
  VERSION_RE = eval(versionReMatch[1]); // eslint-disable-line no-eval
  check(VERSION_RE instanceof RegExp, '_VERSION_RE is a valid RegExp');
  check(VERSION_RE.test('1.2.3'),    '_VERSION_RE accepts "1.2.3"');
  check(VERSION_RE.test('10.20.30'), '_VERSION_RE accepts "10.20.30"');
  check(!VERSION_RE.test('1.2'),     '_VERSION_RE rejects partial "1.2"');
  check(!VERSION_RE.test('1.2.3-beta'), '_VERSION_RE rejects pre-release "1.2.3-beta"');
  check(!VERSION_RE.test(''),        '_VERSION_RE rejects empty string');
  check(!VERSION_RE.test('abc'),     '_VERSION_RE rejects non-numeric "abc"');
}

console.log('\n--- scheduleRmAlarm: pollSeconds-to-minutes conversion, minimum 0.5 --');

// Extract the pure arithmetic from scheduleRmAlarm and test it in a vm sandbox
// together with a stub chrome.alarms that records what it received.
const scheduleRmAlarmFn = src.match(
  /async function scheduleRmAlarm\(seconds\)\s*\{[\s\S]*?\n\}/
);
check(!!scheduleRmAlarmFn, 'scheduleRmAlarm function extracted from source');

if (scheduleRmAlarmFn) {
  const createdAlarms = [];
  const clearedAlarms = [];

  const sandbox = {
    chrome: {
      alarms: {
        clear:  async name => { clearedAlarms.push(name); },
        create: async (name, opts) => { createdAlarms.push({ name, opts }); },
      },
    },
    // RM_ALARM constant used inside the function
    RM_ALARM: 'request-monitor-poll',
  };

  vm.runInNewContext(
    scheduleRmAlarmFn[0] + '\nthis.scheduleRmAlarm = scheduleRmAlarm;',
    sandbox
  );

  const fn = sandbox.scheduleRmAlarm;
  check(typeof fn === 'function', 'scheduleRmAlarm is callable');

  // 60 s → 1.0 min
  await fn(60);
  check(
    createdAlarms.length === 1 && createdAlarms[0].opts.periodInMinutes === 1,
    'scheduleRmAlarm(60) schedules periodInMinutes=1'
  );
  createdAlarms.length = 0; clearedAlarms.length = 0;

  // 120 s → 2.0 min
  await fn(120);
  check(
    createdAlarms[0] && createdAlarms[0].opts.periodInMinutes === 2,
    'scheduleRmAlarm(120) schedules periodInMinutes=2'
  );
  createdAlarms.length = 0; clearedAlarms.length = 0;

  // Values below the 0.5 min floor are clamped
  await fn(10);
  check(
    createdAlarms[0] && createdAlarms[0].opts.periodInMinutes === 0.5,
    'scheduleRmAlarm(10) clamps to minimum 0.5 min (10/60=0.166 < 0.5)'
  );
  createdAlarms.length = 0; clearedAlarms.length = 0;

  // Alarm name matches the constant
  await fn(60);
  check(
    clearedAlarms[0] === 'request-monitor-poll' && createdAlarms[0] && createdAlarms[0].name === 'request-monitor-poll',
    'scheduleRmAlarm uses the RM_ALARM name ("request-monitor-poll") for both clear and create'
  );
}

console.log('\n--- _ppCheckIntervalMinutes: clamping logic (5..1440) ---------------');

// Extract and test the interval-clamping helper in a vm sandbox.
const ppCheckFn = src.match(
  /async function _ppCheckIntervalMinutes\(\)\s*\{[\s\S]*?\n\}/
);
check(!!ppCheckFn, '_ppCheckIntervalMinutes function extracted');

if (ppCheckFn) {
  // Helper to build a sandbox with a given profile.apply.checkEveryMinutes value.
  async function runPpCheck(checkEveryMinutes) {
    const store = {};
    const sandbox = {
      self: {
        PracticeProfile: {
          fetchProfile: async () =>
            checkEveryMinutes === undefined
              ? {}
              : { apply: { checkEveryMinutes } },
        },
      },
      Math,
      isFinite,
      result: null,
    };
    vm.runInNewContext(
      ppCheckFn[0] +
        '\n_ppCheckIntervalMinutes().then(v => { this.result = v; });',
      sandbox
    );
    // Drain the microtask queue
    await new Promise(r => setImmediate(r));
    return sandbox.result;
  }

  const r15 = await runPpCheck(undefined);
  check(r15 === 15, `default (no value) returns 15 (got ${r15})`);

  const r30 = await runPpCheck(30);
  check(r30 === 30, `checkEveryMinutes=30 returns 30 (got ${r30})`);

  const rMin = await runPpCheck(1); // below floor
  check(rMin === 5, `checkEveryMinutes=1 is clamped up to 5 (got ${rMin})`);

  const rMax = await runPpCheck(9999); // above ceiling
  check(rMax === 1440, `checkEveryMinutes=9999 is clamped down to 1440 (got ${rMax})`);

  const rEdgeLo = await runPpCheck(5);
  check(rEdgeLo === 5, `checkEveryMinutes=5 stays at floor 5 (got ${rEdgeLo})`);

  const rEdgeHi = await runPpCheck(1440);
  check(rEdgeHi === 1440, `checkEveryMinutes=1440 stays at ceiling 1440 (got ${rEdgeHi})`);
}

console.log('\n--- _maybeShowUpdateNotification: dedup + notifiedVersions capped at 10 ---');

// Extract and behaviourally test the notification dedup + versions-list cap.
const maybeNotifFn = src.match(
  /async function _maybeShowUpdateNotification\(version\)\s*\{[\s\S]*?\n\}/
);
check(!!maybeNotifFn, '_maybeShowUpdateNotification function extracted');

if (maybeNotifFn) {
  function buildNotifSandbox(existingNotified) {
    const store = {};
    if (existingNotified !== undefined) {
      store['suite.practiceProfile'] = { updateNotifiedVersions: existingNotified };
    }
    const notifications = [];
    const sandbox = {
      chrome: {
        storage: {
          local: {
            get:  async key => ({ [key]: store[key] }),
            set:  async obj => { Object.assign(store, obj); },
          },
        },
        notifications: {
          create: (id, opts, cb) => { notifications.push({ id, opts }); if (cb) cb(); },
        },
        runtime: { lastError: null },
      },
      META_KEY: 'suite.practiceProfile',
      notifications,
      store,
    };
    return sandbox;
  }

  // Case 1: version not yet notified — notification should fire
  {
    const sandbox = buildNotifSandbox([]);
    vm.runInNewContext(
      maybeNotifFn[0] + '\nthis._run = _maybeShowUpdateNotification;',
      sandbox
    );
    await sandbox._run('2.0.0');
    await new Promise(r => setImmediate(r));
    check(sandbox.notifications.length === 1,
      'notification fires when version is new (not yet in notifiedVersions)');
    check(sandbox.notifications[0].id === 'pp_update_2.0.0',
      'notification id contains the version string');
    const saved = sandbox.store['suite.practiceProfile'] && sandbox.store['suite.practiceProfile'].updateNotifiedVersions;
    check(Array.isArray(saved) && saved.includes('2.0.0'),
      'version is persisted into updateNotifiedVersions after first notification');
  }

  // Case 2: version already notified — no second notification
  {
    const sandbox = buildNotifSandbox(['2.0.0']);
    vm.runInNewContext(
      maybeNotifFn[0] + '\nthis._run = _maybeShowUpdateNotification;',
      sandbox
    );
    await sandbox._run('2.0.0');
    await new Promise(r => setImmediate(r));
    check(sandbox.notifications.length === 0,
      'no duplicate notification when version already in notifiedVersions (dedup guard)');
  }

  // Case 3: list is capped at 10 entries
  {
    // Start with exactly 10 old entries so the 11th would overflow without the cap
    const oldVersions = ['0.1.0','0.2.0','0.3.0','0.4.0','0.5.0',
                         '0.6.0','0.7.0','0.8.0','0.9.0','1.0.0'];
    const sandbox = buildNotifSandbox(oldVersions);
    vm.runInNewContext(
      maybeNotifFn[0] + '\nthis._run = _maybeShowUpdateNotification;',
      sandbox
    );
    await sandbox._run('1.1.0');
    await new Promise(r => setImmediate(r));
    const saved = sandbox.store['suite.practiceProfile'] && sandbox.store['suite.practiceProfile'].updateNotifiedVersions;
    check(Array.isArray(saved) && saved.length === 10,
      'updateNotifiedVersions is capped at 10 entries after adding an 11th version');
    check(saved && !saved.includes('0.1.0'),
      'oldest entry is evicted when cap is reached');
    check(saved && saved.includes('1.1.0'),
      'new version is present in the capped list');
  }

  // Case 4: no prior meta key — defaults to empty list, should notify once
  {
    const sandbox = buildNotifSandbox(undefined); // no key in store at all
    vm.runInNewContext(
      maybeNotifFn[0] + '\nthis._run = _maybeShowUpdateNotification;',
      sandbox
    );
    await sandbox._run('3.0.0');
    await new Promise(r => setImmediate(r));
    check(sandbox.notifications.length === 1,
      'notification fires when meta key is absent (empty fallback)');
  }
}

console.log('\n--- notification title formatting in sendRmNotifications --------------');

// Extract the title-building and message-building logic by running the body of
// sendRmNotifications with stubs so we can inspect what gets created.
const sendRmFn = src.match(
  /async function sendRmNotifications\(freshByBucket, cfg, practiceCode\)\s*\{[\s\S]*?\n\}/
);
check(!!sendRmFn, 'sendRmNotifications function extracted');

if (sendRmFn) {
  function buildRmSandbox(existingMap) {
    const store = {};
    if (existingMap) store['suite.requestMonitor.notifMap'] = existingMap;
    const created = [];
    const sandbox = {
      chrome: {
        storage: {
          local: {
            get:  async key => ({ [key]: store[key] }),
            set:  async obj => { Object.assign(store, obj); },
          },
        },
        notifications: {
          create: (id, opts, cb) => { created.push({ id, opts }); if (cb) cb(); },
        },
        runtime: { lastError: null },
      },
      self: {
        RequestMonitor: {
          buildClickUrl: (code, taskType, status, assigneeId) =>
            `https://example.medicus.health/${code}/tasks?type=${taskType}&status=${status}&assignee=${assigneeId}`,
        },
      },
      RM_NOTIF_MAP_KEY: 'suite.requestMonitor.notifMap',
      Date: { now: () => 1000000 },
      Object,
      created,
      store,
    };
    return sandbox;
  }

  // Test 1: single medical new-request with initials
  {
    const freshByBucket = {
      'k1': {
        bucket: { key: 'k1', taskType: 'medical', status: 'new-request' },
        items:  [{ patient: 'JD' }],
      },
    };
    const cfg = { assigneeId: 'a1', notifySound: true };
    const sandbox = buildRmSandbox({});
    vm.runInNewContext(
      sendRmFn[0] + '\nthis._run = sendRmNotifications;',
      sandbox
    );
    await sandbox._run(freshByBucket, cfg, 'abc123');
    await new Promise(r => setImmediate(r));
    check(sandbox.created.length === 1, 'one notification created for one bucket');
    check(sandbox.created[0].opts.title === 'Medical: 1 new request',
      `single medical new-request title is correct (got "${sandbox.created[0] && sandbox.created[0].opts.title}")`);
    check(sandbox.created[0].opts.message === 'JD — 1 new request',
      `single item message shows initials (got "${sandbox.created[0] && sandbox.created[0].opts.message}")`);
    check(sandbox.created[0].opts.priority === 2,
      'new-request has priority 2');
    check(sandbox.created[0].opts.requireInteraction === true,
      'new-request sets requireInteraction');
    check(sandbox.created[0].opts.silent === false,
      'notifySound:true → silent:false');
  }

  // Test 2: multiple admin reply-received items (count-only message, no initials)
  {
    const freshByBucket = {
      'k2': {
        bucket: { key: 'k2', taskType: 'admin', status: 'reply-received' },
        items:  [{ patient: 'AB' }, { patient: 'CD' }, { patient: 'EF' }],
      },
    };
    const cfg = { assigneeId: 'a1', notifySound: false };
    const sandbox = buildRmSandbox({});
    vm.runInNewContext(
      sendRmFn[0] + '\nthis._run = sendRmNotifications;',
      sandbox
    );
    await sandbox._run(freshByBucket, cfg, 'abc123');
    await new Promise(r => setImmediate(r));
    check(sandbox.created[0] && sandbox.created[0].opts.title === 'Admin: 3 reply receiveds',
      `plural admin reply title is correct (got "${sandbox.created[0] && sandbox.created[0].opts.title}")`);
    check(sandbox.created[0] && sandbox.created[0].opts.message === '3 reply receiveds',
      `multi-item message is count-only — no patient names leaked (got "${sandbox.created[0] && sandbox.created[0].opts.message}")`);
    check(sandbox.created[0] && sandbox.created[0].opts.priority === 1,
      'reply-received has priority 1');
    check(sandbox.created[0] && sandbox.created[0].opts.silent === true,
      'notifySound:false → silent:true');
  }

  // Test 3: notifMap cap — pre-load 50 entries, send 1 new notification,
  // confirm saved map has exactly 50 entries (oldest evicted).
  {
    const existingMap = {};
    for (let i = 0; i < 50; i++) existingMap[`mrm_old_${i}`] = `https://old/${i}`;
    const freshByBucket = {
      'k3': {
        bucket: { key: 'k3', taskType: 'medical', status: 'new-request' },
        items:  [{ patient: 'XY' }],
      },
    };
    const cfg = { assigneeId: 'a1', notifySound: false };
    const sandbox = buildRmSandbox(existingMap);
    vm.runInNewContext(
      sendRmFn[0] + '\nthis._run = sendRmNotifications;',
      sandbox
    );
    await sandbox._run(freshByBucket, cfg, 'abc123');
    await new Promise(r => setImmediate(r));
    const savedMap = sandbox.store['suite.requestMonitor.notifMap'];
    const savedCount = Object.keys(savedMap).length;
    check(savedCount === 50,
      `notifMap is capped at 50 entries after adding to a full map (got ${savedCount})`);
    const newKey = Object.keys(savedMap).find(k => k.startsWith('mrm_k3_'));
    check(!!newKey,
      'new notification entry is present in the capped map');
    check(!savedMap['mrm_old_0'],
      'oldest entry (mrm_old_0) was evicted from the capped map');
  }

  // Test 4: single item with no initials falls back to plain count message
  {
    const freshByBucket = {
      'k4': {
        bucket: { key: 'k4', taskType: 'medical', status: 'new-request' },
        items:  [{ patient: '' }],
      },
    };
    const cfg = { assigneeId: 'a1', notifySound: false };
    const sandbox = buildRmSandbox({});
    vm.runInNewContext(
      sendRmFn[0] + '\nthis._run = sendRmNotifications;',
      sandbox
    );
    await sandbox._run(freshByBucket, cfg, 'abc123');
    await new Promise(r => setImmediate(r));
    check(sandbox.created[0] && sandbox.created[0].opts.message === '1 new request',
      `single item with no initials shows plain count (got "${sandbox.created[0] && sandbox.created[0].opts.message}")`);
  }
}

console.log('\n--- runStartupTask: sync throws and async rejections are both caught ---');

// Extract and test runStartupTask — it must never let a rejection become an
// unhandled rejection, which would silently swallow e.g. storage-quota failures.
const runStartupFn = src.match(
  /function runStartupTask\(label, fn\)\s*\{[\s\S]*?\n\}/
);
check(!!runStartupFn, 'runStartupTask function extracted');

if (runStartupFn) {
  const warnings = [];
  const sandbox = {
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    Promise,
  };
  vm.runInNewContext(
    runStartupFn[0] + '\nthis.runStartupTask = runStartupTask;',
    sandbox
  );
  const fn = sandbox.runStartupTask;

  // Synchronous throw
  warnings.length = 0;
  fn('sync-throw-test', () => { throw new Error('bang'); });
  await new Promise(r => setImmediate(r));
  check(warnings.some(w => w.includes('sync-throw-test') && w.includes('bang')),
    'runStartupTask catches synchronous throws and console.warns with label');

  // Async rejection
  warnings.length = 0;
  fn('async-reject-test', () => Promise.reject(new Error('boom')));
  await new Promise(r => setTimeout(r, 10));
  check(warnings.some(w => w.includes('async-reject-test') && w.includes('boom')),
    'runStartupTask catches async rejections and console.warns with label');

  // Happy path: no warnings for a successful async task
  warnings.length = 0;
  fn('happy', () => Promise.resolve('ok'));
  await new Promise(r => setImmediate(r));
  check(warnings.length === 0,
    'runStartupTask does not warn on a successful async function');
}

console.log('\n--- RM_CONFIG_KEYS allowlist: state keys are absent ----------------');

// The comment in the source explains that state/notifMap/authError must NOT
// be in RM_CONFIG_KEYS, otherwise every poll write would cause an infinite
// reinit loop.  Lock this by extracting the Set contents from source.
const rmConfigKeysMatch = src.match(
  /const RM_CONFIG_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/
);
check(!!rmConfigKeysMatch, 'RM_CONFIG_KEYS Set literal found in source');

if (rmConfigKeysMatch) {
  const keysRaw = rmConfigKeysMatch[1].match(/'([^']+)'/g) || [];
  const keys = keysRaw.map(k => k.replace(/'/g, ''));
  check(keys.length >= 5, `RM_CONFIG_KEYS contains at least 5 entries (found ${keys.length}: ${keys.join(', ')})`);
  check(!keys.includes('suite.requestMonitor.notifMap'),
    'RM_CONFIG_KEYS does NOT contain notifMap key (would cause infinite reinit loop)');
  check(!keys.includes('suite.requestMonitor.authError'),
    'RM_CONFIG_KEYS does NOT contain authError key (would cause infinite reinit loop)');
  check(!keys.includes('suite.requestMonitor.state'),
    'RM_CONFIG_KEYS does NOT contain state key (would cause infinite reinit loop)');
  check(keys.includes('suite.requestMonitor.enabled'),
    'RM_CONFIG_KEYS contains "enabled" config key');
  check(keys.includes('suite.requestMonitor.assigneeId'),
    'RM_CONFIG_KEYS contains "assigneeId" config key');
  check(keys.includes('suite.requestMonitor.pollSeconds'),
    'RM_CONFIG_KEYS contains "pollSeconds" config key');
}

console.log('\n--- update checker: daily alarm uses 1440-minute period + 1-min delay ---');

// Guards that the update check won't run every minute by mistake.
const initUpdateFn = src.match(
  /async function initialiseUpdateChecker\(\)\s*\{[\s\S]*?\n\}/
);
check(!!initUpdateFn, 'initialiseUpdateChecker function extracted');
check(
  initUpdateFn && /periodInMinutes:\s*60\s*\*\s*24/.test(initUpdateFn[0]),
  'initialiseUpdateChecker schedules alarm with periodInMinutes: 60 * 24 (daily)'
);
check(
  initUpdateFn && /delayInMinutes:\s*1/.test(initUpdateFn[0]),
  'initialiseUpdateChecker uses delayInMinutes: 1 (deferred first fire)'
);

console.log('\n--- data-minimisation: full patient names not used in notification message ---');

// The comment in the source calls this out as F2 DATA-MINIMISATION.
// Lock: the message branch for multiple items must never reference `.patient`
// (which holds initials — but we want to confirm the multi-item path doesn't
// even reach patient data, so count-only is guaranteed).
//
// The multi-item branch is the `else` block after `if (count === 1)`.
// We extract it and confirm it has no reference to .patient at all.
const multiItemBranch = sendRmNotifFn && sendRmNotifFn[0].match(/\} else \{([^}]+)\}/);
check(
  multiItemBranch && !/\.patient/.test(multiItemBranch[1]),
  'multi-item else branch does not reference .patient field (count-only, no data leak)'
);
// The single-item branch is explicitly allowed to use initials:
check(
  sendRmNotifFn && /items\[0\]\.patient/.test(sendRmNotifFn[0]),
  'single-item branch accesses items[0].patient for initials (by design)'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);

})();
