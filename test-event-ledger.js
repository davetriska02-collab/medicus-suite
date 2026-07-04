// Medicus Suite — shared/event-ledger.js unit tests (F2 Clinical Event Ledger)
// Run with: node test-event-ledger.js
//
// Pins:
//   • makeEvent shape validation — unknown source/action → null; field clipping
//   • sanitisePatientRef — UUIDs pass (lowercased), patient NAMES are rejected to null
//   • record() appends newest-first via a fake chrome.storage.local
//   • cap: never more than MAX_EVENTS after append (newest kept)
//   • retention: events older than RETENTION_DAYS pruned on append
//   • dedupe: same patient+ruleId+action same calendar day → one event;
//     different day / action / patient → separate events; opt-in only
//   • filterEvents — patient UUID exact + prefix, inclusive date range
//   • eventsCsv — RFC-4180 quoting + spreadsheet formula-injection guard
//   • fire-and-forget: record/getEvents/clearLedger swallow a THROWING storage
//     layer (get throws, set rejects, quota-full) — resolve, never throw

'use strict';

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

// ── Fake chrome.storage.local ────────────────────────────────────────────────
// Promise-based (MV3) like the real one. `failMode` lets tests simulate a
// throwing/rejecting/quota-full storage layer.

const store = {};
let failMode = null; // null | 'get-throws' | 'set-rejects' | 'quota'

global.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (failMode === 'get-throws') throw new Error('simulated storage get failure');
        const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
        const out = {};
        ks.forEach((k) => {
          if (k in store) out[k] = store[k];
        });
        return out;
      },
      async set(obj) {
        if (failMode === 'set-rejects') return Promise.reject(new Error('simulated storage set rejection'));
        if (failMode === 'quota') throw new Error('QUOTA_BYTES quota exceeded');
        Object.assign(store, obj);
      },
      async remove(key) {
        if (failMode === 'get-throws') throw new Error('simulated storage remove failure');
        delete store[key];
      },
    },
  },
};

const Ledger = require('./shared/event-ledger.js');
const KEY = Ledger.constants.STORAGE_KEY;
const MAX = Ledger.constants.MAX_EVENTS;
const RETENTION_DAYS = Ledger.constants.RETENTION_DAYS;

const UUID = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';
const UUID2 = 'ffee0011-2233-4455-6677-889900aabbcc';

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  failMode = null;
  Ledger.resetSessionDedupe();
}

function baseEvent(over) {
  return Object.assign(
    {
      source: 'sentinel',
      patientRef: UUID,
      severity: 'red',
      ruleId: 'methotrexate-maintenance',
      label: 'Methotrexate',
      action: 'shown',
    },
    over || {}
  );
}

async function runTests() {
  // ── makeEvent shape validation ────────────────────────────────────────────
  console.log('\n--- makeEvent ---');
  const now = '2026-07-01T10:00:00.000Z';
  let e = Ledger.makeEvent(baseEvent(), now);
  check(e && e.ts === now && e.source === 'sentinel' && e.action === 'shown', 'valid event normalised, ts defaulted');
  check(e.patientRef === UUID && e.ruleId === 'methotrexate-maintenance', 'patientRef + ruleId preserved');
  check(Ledger.makeEvent(baseEvent({ source: 'evil' }), now) === null, 'unknown source → null');
  check(Ledger.makeEvent(baseEvent({ action: 'exfiltrated' }), now) === null, 'unknown action → null');
  check(Ledger.makeEvent(null, now) === null, 'null raw → null');
  e = Ledger.makeEvent(baseEvent({ label: 'x'.repeat(500) }), now);
  check(e.label.length === Ledger.constants.MAX_LABEL_LEN, 'label clipped to MAX_LABEL_LEN');
  e = Ledger.makeEvent(baseEvent({ ts: '2026-06-30T09:00:00.000Z' }), now);
  check(e.ts === '2026-06-30T09:00:00.000Z', 'caller-supplied ts kept');

  // ── leaflets source/action — shared/leaflets-utils.js leafletOpenLedgerEvent shape ──
  console.log('\n--- makeEvent: leaflets source ---');
  const leafletEvt = {
    ts: now,
    source: 'leaflets',
    patientRef: null,
    severity: null,
    ruleId: null,
    label: 'eczema',
    action: 'opened',
  };
  e = Ledger.makeEvent(leafletEvt, now);
  check(e && e.source === 'leaflets' && e.action === 'opened', 'leaflets/opened accepted');
  check(
    e.patientRef === null && e.severity === null && e.ruleId === null,
    'leaflets event carries no patient/rule fields'
  );
  check(e.label === 'eczema', 'leaflets label (slug) preserved');

  // ── sanitisePatientRef — the PHI backstop ─────────────────────────────────
  console.log('\n--- sanitisePatientRef (UUID only, never a name) ---');
  check(Ledger.sanitisePatientRef(UUID) === UUID, 'lowercase UUID passes');
  check(Ledger.sanitisePatientRef(UUID.toUpperCase()) === UUID, 'uppercase UUID passes, lowercased');
  check(Ledger.sanitisePatientRef('Smith, Margaret') === null, 'patient name rejected → null');
  check(Ledger.sanitisePatientRef('John Smith') === null, 'name with space rejected → null');
  check(Ledger.sanitisePatientRef('') === null, 'empty → null');
  check(Ledger.sanitisePatientRef(null) === null, 'null → null');
  check(Ledger.sanitisePatientRef('deadbeef01') === 'deadbeef01', 'short hex id passes (Medicus site-style ids)');
  const evName = Ledger.makeEvent(baseEvent({ patientRef: 'Smith, Margaret' }), now);
  check(evName.patientRef === null, 'makeEvent stores null when a name is passed as patientRef');

  // ── record(): append newest-first ─────────────────────────────────────────
  console.log('\n--- record: append ---');
  reset();
  let ok = await Ledger.record(baseEvent({ ts: '2026-07-01T09:00:00.000Z' }));
  check(ok === true, 'first record resolves true');
  ok = await Ledger.record(baseEvent({ ts: '2026-07-01T10:00:00.000Z', ruleId: 'lithium-maintenance' }));
  check(ok === true, 'second record resolves true');
  let arr = store[KEY];
  check(Array.isArray(arr) && arr.length === 2, 'two events stored');
  check(arr[0].ruleId === 'lithium-maintenance', 'newest first');
  check(!('name' in arr[0]) && !('patientName' in arr[0]), 'no name-like fields in stored shape');
  ok = await Ledger.record(baseEvent({ source: 'nonsense' }));
  check(ok === false && store[KEY].length === 2, 'invalid event skipped, nothing written');

  // ── cap (MAX_EVENTS) ──────────────────────────────────────────────────────
  console.log('\n--- cap ---');
  reset();
  const nowMs = Date.now();
  // Pre-fill at cap with recent events (newest-first), then append one more.
  store[KEY] = [];
  for (let i = 0; i < MAX; i++) {
    store[KEY].push({
      ts: new Date(nowMs - i * 1000).toISOString(),
      source: 'sentinel',
      patientRef: UUID,
      severity: 'amber',
      ruleId: 'rule-' + i,
      label: null,
      action: 'shown',
    });
  }
  ok = await Ledger.record(baseEvent({ ruleId: 'the-newest-rule', ts: new Date(nowMs + 1000).toISOString() }));
  check(ok === true, 'append at cap succeeds');
  check(store[KEY].length === MAX, `length stays at cap (${MAX})`);
  check(store[KEY][0].ruleId === 'the-newest-rule', 'newest event kept at head');
  check(store[KEY][MAX - 1].ruleId === 'rule-' + (MAX - 2), 'oldest event evicted');

  // ── retention (RETENTION_DAYS) ────────────────────────────────────────────
  console.log('\n--- retention ---');
  reset();
  const fresh = new Date(nowMs - 1 * 86400000).toISOString(); // 1 day old
  const edge = new Date(nowMs - (RETENTION_DAYS - 1) * 86400000).toISOString(); // inside window
  const stale = new Date(nowMs - (RETENTION_DAYS + 5) * 86400000).toISOString(); // outside window
  store[KEY] = [
    { ts: fresh, source: 'sweep', patientRef: null, severity: null, ruleId: null, label: 'a', action: 'sweep-run' },
    { ts: edge, source: 'sweep', patientRef: null, severity: null, ruleId: null, label: 'b', action: 'sweep-run' },
    { ts: stale, source: 'sweep', patientRef: null, severity: null, ruleId: null, label: 'c', action: 'sweep-run' },
  ];
  await Ledger.record(baseEvent());
  arr = store[KEY];
  check(arr.length === 3, `stale event pruned on append (kept ${arr.length})`);
  check(!arr.some((x) => x.label === 'c'), 'the >90-day-old event is gone');
  check(
    arr.some((x) => x.label === 'b'),
    'the in-window event survives'
  );

  // pruneEvents pure-function edge: malformed entries dropped
  const pruned = Ledger.pruneEvents([null, { noTs: true }, { ts: fresh }], new Date(nowMs).toISOString());
  check(pruned.length === 1, 'pruneEvents drops malformed entries');

  // ── dedupe (same patient+ruleId+action, same calendar day) ────────────────
  console.log('\n--- dedupe ---');
  reset();
  const day1a = '2026-07-01T09:00:00.000Z';
  const day1b = '2026-07-01T15:00:00.000Z';
  const day2 = '2026-07-02T09:00:00.000Z';
  ok = await Ledger.record(baseEvent({ ts: day1a }), { dedupe: true });
  check(ok === true, 'first shown event recorded');
  ok = await Ledger.record(baseEvent({ ts: day1b }), { dedupe: true });
  check(ok === false && store[KEY].length === 1, 'same patient+rule+action same day → deduped');
  // Session cache also short-circuits without a storage read:
  Ledger.resetSessionDedupe();
  ok = await Ledger.record(baseEvent({ ts: day1b }), { dedupe: true });
  check(ok === false && store[KEY].length === 1, 'dedupe holds across a session-cache reset (storage scan)');
  ok = await Ledger.record(baseEvent({ ts: day2 }), { dedupe: true });
  check(ok === true && store[KEY].length === 2, 'next calendar day → new event');
  ok = await Ledger.record(baseEvent({ ts: day2, action: 'dismissed' }), { dedupe: true });
  check(ok === true && store[KEY].length === 3, 'different action same day → new event');
  ok = await Ledger.record(baseEvent({ ts: day2, patientRef: UUID2 }), { dedupe: true });
  check(ok === true && store[KEY].length === 4, 'different patient same day → new event');
  ok = await Ledger.record(baseEvent({ ts: day2 }));
  check(ok === true && store[KEY].length === 5, 'without the dedupe flag duplicates are allowed');

  // hasSameDayDuplicate pure form
  const ded = [{ ts: day1a, patientRef: UUID, ruleId: 'r1', action: 'shown' }];
  check(
    Ledger.hasSameDayDuplicate(ded, { ts: day1b, patientRef: UUID, ruleId: 'r1', action: 'shown' }) === true,
    'hasSameDayDuplicate: same day+key → true'
  );
  check(
    Ledger.hasSameDayDuplicate(ded, { ts: day2, patientRef: UUID, ruleId: 'r1', action: 'shown' }) === false,
    'hasSameDayDuplicate: other day → false'
  );

  // ── filterEvents ──────────────────────────────────────────────────────────
  console.log('\n--- filterEvents ---');
  const evts = [
    { ts: '2026-07-03T10:00:00.000Z', patientRef: UUID, action: 'shown' },
    { ts: '2026-07-02T10:00:00.000Z', patientRef: UUID2, action: 'shown' },
    { ts: '2026-06-20T10:00:00.000Z', patientRef: UUID, action: 'filed' },
    { ts: '2026-06-10T10:00:00.000Z', patientRef: null, action: 'sweep-run' },
  ];
  check(Ledger.filterEvents(evts, {}).length === 4, 'no filter → all');
  check(Ledger.filterEvents(evts, { patientRef: UUID }).length === 2, 'exact UUID match');
  check(Ledger.filterEvents(evts, { patientRef: '0a1b2c3d' }).length === 2, 'UUID prefix match');
  check(Ledger.filterEvents(evts, { patientRef: UUID.toUpperCase() }).length === 2, 'case-insensitive match');
  check(Ledger.filterEvents(evts, { patientRef: 'zzz' }).length === 0, 'non-matching prefix → none');
  check(Ledger.filterEvents(evts, { from: '2026-07-02' }).length === 2, 'from date inclusive');
  check(Ledger.filterEvents(evts, { to: '2026-06-20' }).length === 2, 'to date inclusive');
  check(
    Ledger.filterEvents(evts, { from: '2026-06-20', to: '2026-07-02' }).length === 2,
    'date range inclusive both ends'
  );
  check(
    Ledger.filterEvents(evts, { patientRef: UUID, from: '2026-07-01' }).length === 1,
    'patient + date combine (AND)'
  );

  // ── eventsCsv — escaping + formula-injection guard ────────────────────────
  console.log('\n--- eventsCsv ---');
  const csv = Ledger.eventsCsv([
    {
      ts: '2026-07-01T10:00:00.000Z',
      source: 'sentinel',
      patientRef: UUID,
      severity: 'red',
      ruleId: 'r,1',
      label: 'has "quotes" and, commas',
      action: 'shown',
    },
    {
      ts: '2026-07-01T11:00:00.000Z',
      source: 'labfiling',
      patientRef: null,
      severity: null,
      ruleId: '=HYPERLINK("http://evil")',
      label: '+SUM(A1:A9)',
      action: 'filed',
    },
  ]);
  const lines = csv.split('\r\n');
  check(lines[0] === 'ts,source,patientRef,severity,ruleId,label,action', 'header row');
  check(lines.length === 3, 'one row per event');
  check(lines[1].includes('"r,1"'), 'comma-bearing cell quoted');
  check(lines[1].includes('"has ""quotes"" and, commas"'), 'quotes doubled per RFC-4180');
  check(lines[2].includes(`"'=HYPERLINK(""http://evil"")"`), 'leading = neutralised with apostrophe');
  check(lines[2].includes("'+SUM(A1:A9)"), 'leading + neutralised with apostrophe');
  check(Ledger.csvCell('-2+3') === "'-2+3", 'leading - neutralised');
  check(Ledger.csvCell('@cmd') === "'@cmd", 'leading @ neutralised');
  check(Ledger.csvCell('plain') === 'plain', 'plain cell untouched');
  check(Ledger.eventsCsv([]) === 'ts,source,patientRef,severity,ruleId,label,action', 'empty ledger → header only');

  // ── fire-and-forget: throwing storage layer never breaks callers ──────────
  console.log('\n--- fire-and-forget on storage failure ---');
  reset();
  const realWarn = console.warn;
  let warns = 0;
  console.warn = () => {
    warns++;
  };
  try {
    failMode = 'get-throws';
    ok = await Ledger.record(baseEvent());
    check(ok === false, 'record survives a THROWING storage.get (resolves false, no throw)');
    failMode = 'set-rejects';
    ok = await Ledger.record(baseEvent());
    check(ok === false, 'record survives a REJECTING storage.set');
    failMode = 'quota';
    ok = await Ledger.record(baseEvent());
    check(ok === false, 'record survives a quota-exceeded storage.set');
    failMode = 'get-throws';
    const got = await Ledger.getEvents();
    check(Array.isArray(got) && got.length === 0, 'getEvents returns [] on storage failure');
    ok = await Ledger.clearLedger();
    check(ok === false, 'clearLedger resolves false on storage failure');
    check(warns >= 5, `failures are console.warn-ed, never thrown (${warns} warns)`);
  } finally {
    console.warn = realWarn;
  }

  // Storage entirely absent (e.g. plain Node) — still never throws.
  const savedChrome = global.chrome;
  global.chrome = undefined;
  ok = await Ledger.record(baseEvent());
  check(ok === false, 'record with NO chrome.storage at all resolves false');
  check((await Ledger.getEvents()).length === 0, 'getEvents with no storage → []');
  global.chrome = savedChrome;

  // ── clearLedger ───────────────────────────────────────────────────────────
  console.log('\n--- clearLedger ---');
  reset();
  await Ledger.record(baseEvent());
  check(store[KEY].length === 1, 'precondition: one event stored');
  ok = await Ledger.clearLedger();
  check(ok === true && !(KEY in store), 'clearLedger removes the key');
  // Dedupe cache is reset too — the same event can be recorded again.
  ok = await Ledger.record(baseEvent(), { dedupe: true });
  check(ok === true, 'after clear, a previously-deduped event records again');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
