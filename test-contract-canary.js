// Medicus Suite — shared/contract-canary.js unit tests (Horizon-1 H2)
// Run with: node test-contract-canary.js
//
// Pins:
//   • hysteresis — nextContractState(): 1 FAIL never demotes to 'degraded'; 2
//     FAILs spaced >= 30s apart DO promote to 'degraded'; 2 FAILs closer than
//     30s apart do NOT (the streak holds, waiting for real spacing); a single
//     OK probe recovers a 'degraded' contract immediately; NOT_APPLICABLE
//     never disturbs an already-established status and never counts toward
//     the FAIL streak.
//   • debounce — shouldProbeNow(): no previous round -> probe now; < 5s since
//     the last round -> wait; >= 5s -> probe.
//   • pageMatch filtering — contractsForPage() against the REAL
//     shared/dom-contracts.js registry: an overview-page URL selects the
//     overview-scoped runtime:true contracts (+ the pageMatch:null universal
//     one) and NOT the queue-scoped ones, and vice versa.
//   • runtime:false contracts are NEVER selected by contractsForPage(), on
//     any URL, including the one whose pageMatch is null (universal).
//   • storage-failure tolerance — runProbeRound() swallows a throwing/
//     rejecting chrome.storage.local (get-throws, set-rejects) and resolves
//     null rather than throwing.
//   • ledger integration — a genuine ok->degraded / degraded->ok transition
//     records one shared/event-ledger.js event (source 'health', patientRef
//     null, action contract-degraded/contract-recovered); a second
//     ok->degraded transition on the SAME contract on the SAME calendar day
//     is deduped by the ledger's own { dedupe: true } option (event count
//     does not grow).
//
// House harness style (test-event-ledger.js is the closest sibling): a tiny
// in-memory chrome.storage.local mock with a `failMode` switch, `check()`
// pass/fail counter, real shared/dom-contracts.js + shared/event-ledger.js
// (not re-implemented), a hand-rolled fake DomContracts for the
// runProbeRound() integration tests so hysteresis timing is deterministic
// without a real DOM or a real 30s wall-clock wait.

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
const store = {};
let failMode = null; // null | 'get-throws' | 'set-rejects'

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
        Object.assign(store, obj);
      },
    },
  },
};

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  failMode = null;
}

const CC = require('./shared/contract-canary.js');
const DomContracts = require('./shared/dom-contracts.js');
const EventLedger = require('./shared/event-ledger.js');

// ============================================================
console.log('--- hysteresis: nextContractState() ---');
// ============================================================

const T0 = '2026-07-02T10:00:00.000Z';
const T0_PLUS_10S = '2026-07-02T10:00:10.000Z'; // < 30s after T0
const T0_PLUS_31S = '2026-07-02T10:00:31.000Z'; // >= 30s after T0
const T0_PLUS_40S = '2026-07-02T10:00:40.000Z';

{
  const s1 = CC.nextContractState(null, 'fail', T0);
  check(s1.state.status === 'ok', 'a first-ever FAIL probe settles to ok, not degraded (1 FAIL != degraded)');
  check(s1.transition === null, 'a first-ever FAIL probe fires no ledger transition');
  check(s1.state.failStreak === 1, 'failStreak starts at 1 after the first FAIL');
  check(s1.state.probeCount === 1, 'probeCount increments');

  const s2 = CC.nextContractState(s1.state, 'fail', T0_PLUS_10S);
  check(s2.state.status === 'ok', 'a second FAIL only 10s later (< 30s spacing) still does not degrade');
  check(s2.state.failStreak === 1, 'the streak is held (not advanced) when spacing is too tight');
  check(s2.transition === null, 'no transition fires while spacing is too tight');

  const s3 = CC.nextContractState(s1.state, 'fail', T0_PLUS_31S);
  check(s3.state.status === 'degraded', '2 FAILs spaced >= 30s apart DO promote to degraded');
  check(s3.transition === 'degraded', 'the promoting round reports transition "degraded"');
  check(s3.state.failStreak === 2, 'failStreak reaches 2 on the qualifying round');
  check(s3.state.sinceTs === T0_PLUS_31S, 'sinceTs is stamped to the round that crossed the threshold');

  const s3b = CC.nextContractState(s3.state, 'fail', '2026-07-02T10:01:05.000Z');
  check(s3b.state.status === 'degraded', 'a THIRD spaced FAIL stays degraded');
  check(s3b.transition === null, 'staying degraded does not re-fire the transition every round');

  const s4 = CC.nextContractState(s3.state, 'ok', T0_PLUS_40S);
  check(s4.state.status === 'ok', 'a single OK probe recovers a degraded contract immediately');
  check(s4.transition === 'recovered', 'the recovering round reports transition "recovered"');
  check(s4.state.failStreak === 0, 'failStreak resets to 0 on recovery');
  check(s4.state.lastFailTs === null, 'lastFailTs clears on recovery');

  // First-ever OK (nothing previously known) is a confirmation, not a "recovery".
  const firstOk = CC.nextContractState(null, 'ok', T0);
  check(firstOk.state.status === 'ok', 'a first-ever OK probe settles to ok');
  check(firstOk.transition === null, 'a first-ever OK probe is not logged as a recovery (nothing to recover from)');

  // NOT_APPLICABLE: never a false alarm, never disturbs an established status,
  // never counts toward/against the FAIL streak.
  const firstNA = CC.nextContractState(null, 'not_applicable', T0);
  check(firstNA.state.status === 'not_applicable', 'a first-ever NOT_APPLICABLE probe settles to not_applicable');
  check(firstNA.transition === null, 'NOT_APPLICABLE never fires a transition');

  const okThenNA = CC.nextContractState(firstOk.state, 'not_applicable', T0_PLUS_10S);
  check(okThenNA.state.status === 'ok', 'NOT_APPLICABLE does not clear an already-established ok status');

  const degradedThenNA = CC.nextContractState(s3.state, 'not_applicable', T0_PLUS_40S);
  check(
    degradedThenNA.state.status === 'degraded',
    'NOT_APPLICABLE does not clear an already-established degraded status'
  );
  check(
    degradedThenNA.state.failStreak === s3.state.failStreak,
    'NOT_APPLICABLE leaves the FAIL streak exactly as it was (does not reset or advance it)'
  );
}

// ============================================================
console.log('\n--- debounce: shouldProbeNow() ---');
// ============================================================
{
  check(CC.shouldProbeNow(null, 1000, 5000) === true, 'no previous round -> probe now');
  check(CC.shouldProbeNow(undefined, 1000, 5000) === true, 'undefined previous round -> probe now');
  check(CC.shouldProbeNow(1000, 1000 + 4999, 5000) === false, '< 5s since the last round -> wait');
  check(CC.shouldProbeNow(1000, 1000 + 5000, 5000) === true, '>= 5s since the last round -> probe');
  check(CC.shouldProbeNow(1000, 1000 + 5000) === true, 'default debounce (no explicit arg) is honoured');
}

// ============================================================
console.log('\n--- pageMatch filtering: contractsForPage() against the real registry ---');
// ============================================================
{
  const all = DomContracts.list();
  const runtimeFalseIds = new Set(all.filter((c) => c.runtime !== true).map((c) => c.id));
  check(runtimeFalseIds.size > 0, 'sanity: the real registry has runtime:false contracts to exercise this check');

  const overviewUrl =
    'https://practice.medicus.health/abcd/tasks/data/prescription-request/overview/11111111-1111-1111-1111-111111111111';
  const forOverview = CC.contractsForPage(all, overviewUrl);
  check(forOverview.length > 0, 'the overview URL selects at least one contract');
  check(
    forOverview.every((c) => c.runtime === true),
    'every selected contract is runtime:true'
  );
  check(
    forOverview.some((c) => c.id === 'oir.checkbox'),
    'oir.checkbox (overview-scoped) applies on an overview URL'
  );
  check(
    forOverview.some((c) => c.id === 'routine-rx.routing-control'),
    'routine-rx.routing-control (prescription-overview-scoped) applies on this overview URL'
  );
  check(
    forOverview.some((c) => c.id === 'api-client.patient-uuid-dom-fallback'),
    'the pageMatch:null universal contract applies on an overview URL too'
  );
  check(
    !forOverview.some((c) => c.id === 'queue.chip-host'),
    'queue.chip-host (queue-scoped) does NOT apply on an overview URL'
  );

  const queueUrl = 'https://practice.medicus.health/tasks/prescription-request/task-list';
  const forQueue = CC.contractsForPage(all, queueUrl);
  check(
    forQueue.some((c) => c.id === 'queue.chip-host'),
    'queue.chip-host applies on a task-list (queue) URL'
  );
  check(!forQueue.some((c) => c.id === 'oir.checkbox'), 'oir.checkbox does NOT apply on a queue URL');
  check(
    forQueue.some((c) => c.id === 'api-client.patient-uuid-dom-fallback'),
    'the pageMatch:null universal contract applies on a queue URL too'
  );

  const unrelatedUrl = 'https://practice.medicus.health/some/other/page';
  const forUnrelated = CC.contractsForPage(all, unrelatedUrl);
  check(
    forUnrelated.every((c) => c.pageMatch == null),
    'on an unrelated page, only pageMatch:null universal contracts are selected'
  );
}

// ============================================================
console.log('\n--- runtime:false contracts are never selected ---');
// ============================================================
{
  const all = DomContracts.list();
  const runtimeFalseIds = new Set(all.filter((c) => c.runtime !== true).map((c) => c.id));
  const everyUrl = [
    'https://practice.medicus.health/abcd/tasks/data/prescription-request/overview/11111111-1111-1111-1111-111111111111',
    'https://practice.medicus.health/tasks/prescription-request/task-list',
    'https://practice.medicus.health/anything-else',
  ];
  let anyRuntimeFalseSelected = false;
  for (const url of everyUrl) {
    for (const c of CC.contractsForPage(all, url)) {
      if (runtimeFalseIds.has(c.id)) anyRuntimeFalseSelected = true;
    }
  }
  check(!anyRuntimeFalseSelected, 'no runtime:false contract is EVER selected by contractsForPage, on any page');
  // sentinel.mount-anchor is specifically runtime:false AND pageMatch:null (the
  // "universal but not probed live" case) — the one most likely to leak through
  // a pageMatch-only filter that forgot the runtime:true guard.
  check(
    runtimeFalseIds.has('sentinel.mount-anchor'),
    'sanity: sentinel.mount-anchor is runtime:false + pageMatch:null in the real registry'
  );
}

// ============================================================
console.log('\n--- applyProbeRound() combines a round across contracts ---');
// ============================================================
{
  const results = [
    { id: 'a', status: 'ok' },
    { id: 'b', status: 'fail' },
  ];
  const { health, transitions } = CC.applyProbeRound(null, results, T0);
  check(health.a.status === 'ok' && health.b.status === 'ok', 'first-round ok/fail both settle non-degraded');
  check(transitions.length === 0, 'no transitions on an establishing round');

  const prev = { a: health.a, b: { ...health.b, lastFailTs: T0 } };
  const round2 = CC.applyProbeRound(
    prev,
    [
      { id: 'a', status: 'ok' },
      { id: 'b', status: 'fail' },
    ],
    T0_PLUS_31S
  );
  check(round2.health.b.status === 'degraded', 'b degrades on the spaced second FAIL');
  check(
    round2.transitions.length === 1 &&
      round2.transitions[0].id === 'b' &&
      round2.transitions[0].transition === 'degraded',
    'applyProbeRound reports exactly the one contract that transitioned'
  );
  check(round2.health.a.status === 'ok', 'a is untouched by b degrading (independent per-contract state)');
}

// ============================================================
console.log('\n--- runProbeRound(): storage-failure tolerance ---');
// ============================================================

function fakeDomContracts(status) {
  const contract = {
    id: 'fake.one',
    feature: 'Fake Feature',
    degradation: 'the fake feature silently stops working',
    runtime: true,
    pageMatch: null,
  };
  return {
    list: () => [contract],
    probeContract: () => ({ id: contract.id, status }),
  };
}

(async () => {
  reset();
  failMode = 'get-throws';
  let r = await CC.runProbeRound({ DomContracts: fakeDomContracts('ok'), href: 'https://x', root: {} });
  check(r === null, 'runProbeRound resolves null (not throw) when chrome.storage.local.get throws');

  reset();
  failMode = 'set-rejects';
  r = await CC.runProbeRound({ DomContracts: fakeDomContracts('ok'), href: 'https://x', root: {} });
  check(r === null, 'runProbeRound resolves null (not throw) when chrome.storage.local.set rejects');

  reset();
  r = await CC.runProbeRound({ DomContracts: null, href: 'https://x', root: {} });
  check(r === null, 'runProbeRound resolves null (not throw) when DomContracts itself is missing');

  console.log('\n--- runProbeRound(): normal round-trip through real chrome.storage ---');
  reset();
  r = await CC.runProbeRound({ DomContracts: fakeDomContracts('ok'), href: 'https://x', root: {} });
  check(!!r && r.health['fake.one'].status === 'ok', 'a normal round persists the probed status');
  check(
    store[CC.STORAGE_KEY]['fake.one'].status === 'ok',
    'the health map lands in chrome.storage.local under health.contracts'
  );
  check(r.transitions.length === 0, 'establishing ok is not logged as a transition');

  console.log('\n--- runProbeRound(): no eligible contract on this page -> null, no storage write ---');
  reset();
  const noneContracts = {
    list: () => [{ id: 'x', runtime: false, pageMatch: null }],
    probeContract: () => ({ id: 'x', status: 'ok' }),
  };
  r = await CC.runProbeRound({ DomContracts: noneContracts, href: 'https://x', root: {} });
  check(r === null, 'runProbeRound is a no-op when no contract on this page is eligible');
  check(!(CC.STORAGE_KEY in store), 'no storage write happens when there is nothing to probe');

  // ============================================================
  console.log('\n--- ledger integration: transitions recorded + deduped per contract per day ---');
  // ============================================================
  reset();
  // Pre-seed a state one qualifying FAIL away from degrading: failStreak 1,
  // lastFailTs safely > 30s in the real past (so THIS round's real Date.now()
  // clears the spacing check without a real 30s test wait).
  const longAgo = new Date(Date.now() - 40000).toISOString();
  store[CC.STORAGE_KEY] = {
    'fake.one': {
      lastProbe: longAgo,
      status: 'ok',
      sinceTs: longAgo,
      probeCount: 3,
      failStreak: 1,
      lastFailTs: longAgo,
    },
  };
  let res = await CC.runProbeRound({
    DomContracts: fakeDomContracts('fail'),
    EventLedger,
    href: 'https://x',
    root: {},
  });
  check(
    !!res && res.transitions.length === 1 && res.transitions[0].transition === 'degraded',
    'the spaced FAIL degrades fake.one this round'
  );
  let events = store[EventLedger.constants.STORAGE_KEY] || [];
  check(events.length === 1, 'exactly one ledger event recorded for the degrade');
  check(events[0].source === 'health', "the ledger event's source is 'health'");
  check(events[0].action === 'contract-degraded', "the ledger event's action is 'contract-degraded'");
  check(events[0].patientRef === null, 'the ledger event carries no patientRef (self-diagnosis, not a clinical event)');
  check(events[0].ruleId === 'fake.one', 'the ledger event carries the contract id as ruleId');
  check(events[0].label.includes('Fake Feature'), "the ledger event's label carries the feature name");

  // Recover.
  res = await CC.runProbeRound({ DomContracts: fakeDomContracts('ok'), EventLedger, href: 'https://x', root: {} });
  check(
    res.transitions.length === 1 && res.transitions[0].transition === 'recovered',
    'the next OK probe recovers fake.one'
  );
  events = store[EventLedger.constants.STORAGE_KEY] || [];
  check(events.length === 2, 'a second ledger event (contract-recovered) is recorded');
  check(events[0].action === 'contract-recovered', 'the newest (recovered) event is first (newest-first ledger)');

  // Force a SECOND degrade on the SAME contract, SAME calendar day: re-seed
  // failStreak 1 / lastFailTs long-ago-but-today so one more spaced FAIL
  // degrades it again.
  const longAgoToday = new Date(Date.now() - 40000).toISOString();
  store[CC.STORAGE_KEY]['fake.one'] = {
    ...store[CC.STORAGE_KEY]['fake.one'],
    status: 'ok',
    failStreak: 1,
    lastFailTs: longAgoToday,
  };
  res = await CC.runProbeRound({ DomContracts: fakeDomContracts('fail'), EventLedger, href: 'https://x', root: {} });
  check(
    res.transitions.length === 1 && res.transitions[0].transition === 'degraded',
    'fake.one degrades a second time the same day'
  );
  events = store[EventLedger.constants.STORAGE_KEY] || [];
  check(
    events.length === 2,
    'the second same-day contract-degraded event is DEDUPED by the ledger (event count does not grow past 2)'
  );

  // ============================================================
  console.log('\n--- runProbeRound(): suppressedByOk false-alarm guard ---');
  // ============================================================
  reset();
  function fakeSuppressedPair(narrowStatus, coveringStatus) {
    const narrow = {
      id: 'fake.narrow',
      feature: 'Fake Narrow',
      degradation: 'x',
      runtime: true,
      pageMatch: null,
      suppressedByOk: 'fake.covering',
    };
    const covering = {
      id: 'fake.covering',
      feature: 'Fake Covering',
      degradation: 'x',
      runtime: true,
      pageMatch: null,
    };
    return {
      STATUS: DomContracts.STATUS,
      list: () => [narrow, covering],
      probeContract: (c) => ({ id: c.id, status: c.id === 'fake.narrow' ? narrowStatus : coveringStatus }),
    };
  }

  res = await CC.runProbeRound({
    DomContracts: fakeSuppressedPair('fail', 'ok'),
    href: 'https://x',
    root: {},
  });
  check(
    res.health['fake.narrow'].status === 'ok',
    'a FAILing contract is treated as ok this round when its suppressedByOk covering contract reads ok'
  );

  reset();
  res = await CC.runProbeRound({
    DomContracts: fakeSuppressedPair('fail', 'fail'),
    href: 'https://x',
    root: {},
  });
  check(
    res.health['fake.narrow'].status === 'ok' && res.health['fake.narrow'].failStreak === 1,
    'the same FAIL still counts toward the streak when the covering contract also FAILs (no blanket suppression)'
  );

  // A real end-to-end sanity check against the actual registry: on a queue
  // URL where queue.preview-row-link's own selectors are absent but
  // queue.chip-host's patientName-cell fallback is present, the health strip
  // must not flag queue.preview-row-link — this is exactly the "chips are
  // visibly working" false alarm this guard exists to fix.
  reset();
  const fakeQueueRoot = {
    querySelectorAll(sel) {
      const present = {
        '.ag-row': [{}],
        '.ag-row [col-id="dateOfBirth"]': [{}],
        '[col-id="patientName"]': [{}], // queue.chip-host's fallback host is present
        // '[row-id^="detail_"]' and '.ag-full-width-row' deliberately absent —
        // the preview row itself is missing this round.
      };
      return present[sel] || [];
    },
  };
  res = await CC.runProbeRound({
    DomContracts: DomContracts,
    href: 'https://practice.medicus.health/tasks/prescription-request/task-list',
    root: fakeQueueRoot,
  });
  check(
    !!res && res.health['queue.preview-row-link'].status === 'ok',
    'end-to-end: queue.preview-row-link reads ok (not degraded) when queue.chip-host is covering via its patientName fallback'
  );

  // ============================================================
  console.log('\n--- runProbeRound(): UUID DOM-fallback ApiClient guard ---');
  // ============================================================
  reset();
  function fakeUuidFallbackOnly(status) {
    const contract = {
      id: 'api-client.patient-uuid-dom-fallback',
      feature: 'Fake UUID Fallback',
      degradation: 'x',
      runtime: true,
      pageMatch: null,
    };
    return {
      list: () => [contract],
      probeContract: () => ({ id: contract.id, status }),
    };
  }

  res = await CC.runProbeRound({
    DomContracts: fakeUuidFallbackOnly('fail'),
    ApiClient: { detectMedicusContext: () => ({ patientUuid: 'abc' }) },
    href: 'https://x',
    root: {},
  });
  check(
    res === null,
    'the UUID DOM-fallback contract is skipped entirely (no-op round) when the URL already resolved a patient id'
  );

  reset();
  res = await CC.runProbeRound({
    DomContracts: fakeUuidFallbackOnly('fail'),
    ApiClient: { detectMedicusContext: () => ({ taskUuid: 'def' }) },
    href: 'https://x',
    root: {},
  });
  check(res === null, 'a URL-resolved taskUuid also skips the UUID DOM-fallback probe');

  reset();
  res = await CC.runProbeRound({
    DomContracts: fakeUuidFallbackOnly('fail'),
    ApiClient: { detectMedicusContext: () => ({ patientUuid: null, encounterUuid: null, taskUuid: null }) },
    href: 'https://x',
    root: {},
  });
  check(
    !!res && res.health['api-client.patient-uuid-dom-fallback'],
    'the UUID DOM-fallback contract is still probed normally when URL resolution found nothing'
  );

  reset();
  res = await CC.runProbeRound({
    DomContracts: fakeUuidFallbackOnly('fail'),
    href: 'https://x',
    root: {},
  });
  check(
    !!res && res.health['api-client.patient-uuid-dom-fallback'],
    'without an ApiClient dep at all, the UUID DOM-fallback contract is probed as before (guard is opt-in)'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
