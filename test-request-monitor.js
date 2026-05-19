// Medicus Suite v1.3 — Request Monitor Tests
// Run with: node test-request-monitor.js

'use strict';

const RM = require('./shared/request-monitor.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── URL construction ─────────────────────────────────────────────────────────

console.log('\n--- URL construction ---');
{
  const url = RM.buildApiUrl('a3f2b1', 'medical_patient_request_task', 'new-request', 'team-uuid-here');
  assert(url.startsWith('https://a3f2b1.api.england.medicus.health/'), 'API URL uses subdomain pattern');
  assert(url.includes('medical_patient_request_task/task-list'), 'API URL includes task-type path');
  assert(url.includes('statuses%5B%5D=new-request') || url.includes('statuses[]=new-request'), 'API URL includes statuses[] param');
  assert(url.includes('masterAssignee=team-uuid-here'), 'API URL includes masterAssignee');
  assert(url.includes('viewContext=homepage'), 'API URL includes viewContext');
}

{
  const url = RM.buildClickUrl('a3f2b1', 'admin_patient_request_task', 'reply-received', 'team-uuid');
  assert(url.startsWith('https://england.medicus.health/a3f2b1/'), 'Click URL is on root medicus.health domain');
  assert(url.includes('/tasks/admin_patient_request_task/task-list'), 'Click URL has tasks path');
}

// ── BUCKETS constant ─────────────────────────────────────────────────────────

console.log('\n--- BUCKETS ---');
assert(Array.isArray(RM.BUCKETS) && RM.BUCKETS.length === 4, 'Four buckets defined');
assert(RM.BUCKETS.every(b => b.key && b.taskType && b.status && b.label), 'Each bucket has key/taskType/status/label');
const keys = RM.BUCKETS.map(b => b.key);
assert(keys.includes('medNew') && keys.includes('medReply') && keys.includes('adminNew') && keys.includes('adminReply'), 'All four bucket keys present');

// ── pollAll with mocked fetch ────────────────────────────────────────────────

console.log('\n--- pollAll (mocked fetch) ---');

// Mock chrome.storage.local for the test
const mockStore = {};
global.chrome = {
  storage: {
    local: {
      get: async (keysOrKey) => {
        if (typeof keysOrKey === 'string') return { [keysOrKey]: mockStore[keysOrKey] };
        if (Array.isArray(keysOrKey)) {
          const out = {};
          for (const k of keysOrKey) if (mockStore[k] !== undefined) out[k] = mockStore[k];
          return out;
        }
        return { ...mockStore };
      },
      set: async (obj) => { Object.assign(mockStore, obj); },
    },
  },
};

(async () => {
  // First poll — all buckets return 2 items each
  const mockFetch = async (url, init) => {
    return {
      ok: true,
      json: async () => ({
        tasks: [
          { id: `task-${url.length}-1`, patientName: 'A. Patient', summary: 'sum', priority: 'normal', createdAt: '2026-05-19' },
          { id: `task-${url.length}-2`, patientName: 'B. Patient', summary: 'sum', priority: 'normal', createdAt: '2026-05-19' },
        ],
      }),
    };
  };

  const r1 = await RM.pollAll('a3f2b1', 'team-uuid', { fetch: mockFetch });
  assert(r1.ok === true, 'pollAll: ok on success');
  assert(r1.totalCount === 8, 'pollAll: totalCount is sum of all 4 buckets × 2 items');
  assert(Object.keys(r1.freshByBucket).length === 4, 'pollAll: first poll marks every item as fresh');
  assert(r1.isFirstPoll === true, 'pollAll: first poll flagged');

  // Second poll — same items returned. Nothing should be fresh.
  const r2 = await RM.pollAll('a3f2b1', 'team-uuid', { fetch: mockFetch });
  assert(r2.totalCount === 8, 'pollAll: second poll same count');
  assert(Object.keys(r2.freshByBucket).length === 0, 'pollAll: second poll has no fresh items (all already seen)');
  assert(r2.isFirstPoll === false, 'pollAll: second poll not flagged as first');

  // Third poll — one extra item in medNew bucket
  const mockFetchWithExtra = async (url, init) => {
    const tasks = [
      { id: `task-${url.length}-1`, patientName: 'A. Patient' },
      { id: `task-${url.length}-2`, patientName: 'B. Patient' },
    ];
    if (url.includes('medical_patient_request_task') && url.includes('new-request')) {
      tasks.push({ id: 'task-NEW-ITEM', patientName: 'C. New Patient' });
    }
    return { ok: true, json: async () => ({ tasks }) };
  };
  const r3 = await RM.pollAll('a3f2b1', 'team-uuid', { fetch: mockFetchWithExtra });
  assert(r3.totalCount === 9, 'pollAll: third poll has +1 item');
  assert(r3.freshByBucket.medNew !== undefined, 'pollAll: medNew bucket flagged with fresh items');
  assert(r3.freshByBucket.medNew.items.length === 1, 'pollAll: exactly one new item');
  assert(r3.freshByBucket.medNew.items[0].id === 'task-NEW-ITEM', 'pollAll: correct new item identified');
  assert(r3.freshByBucket.medReply === undefined, 'pollAll: other buckets not flagged');

  // Fourth poll — item resolved (drops out)
  const r4 = await RM.pollAll('a3f2b1', 'team-uuid', { fetch: mockFetch });
  assert(r4.totalCount === 8, 'pollAll: fourth poll back to 8 items');
  assert(Object.keys(r4.freshByBucket).length === 0, 'pollAll: resolved items do not count as fresh');

  // ── Error handling ────────────────────────────────────────────────────────
  console.log('\n--- Error handling ---');
  const mockFetch403 = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const rErr = await RM.pollAll('a3f2b1', 'team-uuid', { fetch: mockFetch403 });
  assert(rErr.ok === false, 'pollAll: ok=false when fetch returns non-ok');
  assert(rErr.error?.includes('403'), 'pollAll: error message includes HTTP status');

  const mockFetchThrows = async () => { throw new Error('network down'); };
  const rThrow = await RM.pollAll('a3f2b1', 'team-uuid', { fetch: mockFetchThrows });
  assert(rThrow.ok === false, 'pollAll: ok=false when fetch throws');
  assert(rThrow.error?.includes('network down'), 'pollAll: error message includes thrown message');

  // ── Misconfiguration ──────────────────────────────────────────────────────
  console.log('\n--- Misconfiguration ---');
  const noCode = await RM.pollAll('', 'team-uuid', { fetch: mockFetch });
  assert(noCode.ok === false && noCode.error === 'Not configured', 'pollAll: missing practiceCode → Not configured');

  const noTeam = await RM.pollAll('a3f2b1', '', { fetch: mockFetch });
  assert(noTeam.ok === false && noTeam.error === 'Not configured', 'pollAll: missing assigneeId → Not configured');

  // ── Config defaults ───────────────────────────────────────────────────────
  console.log('\n--- Config ---');
  // Clear store
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  const cfg = await RM.getConfig();
  assert(cfg.enabled === false, 'getConfig: enabled defaults to false');
  assert(cfg.pollSeconds === 60, 'getConfig: pollSeconds defaults to 60');
  assert(cfg.notifyEnabled === false, 'getConfig: notifyEnabled defaults to false');

  await RM.setConfig({ pollSeconds: 5 });
  const cfg2 = await RM.getConfig();
  assert(cfg2.pollSeconds === 30, 'getConfig: pollSeconds floored to MIN_POLL_SECONDS (30)');

  await RM.setConfig({ enabled: true, assigneeId: 'uuid', pollSeconds: 120 });
  const cfg3 = await RM.getConfig();
  assert(cfg3.enabled === true && cfg3.assigneeId === 'uuid' && cfg3.pollSeconds === 120, 'setConfig: persists values correctly');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
