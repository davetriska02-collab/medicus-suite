// Medicus Suite — shared my-appointments fetcher tests (audit M10)
// Run with: node test-appointments-feed.js

'use strict';

const fs = require('fs');
const path = require('path');

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

const { createAppointmentsFeed, arrivedEntries, TTL_MS } = require('./shared/appointments-feed.js');

// ============================================================
// Layer 1 — memoisation semantics
// ============================================================
console.log('Layer 1: memo / TTL / coalescing semantics');

function makeHarness({ code = 'abc123' } = {}) {
  const h = {
    now: 1_000_000,
    code,
    fetchCalls: [],
    payload: { schedule: { schedule: [] } },
    fail: false,
  };
  h.feed = createAppointmentsFeed({
    resolveCode: async () => ({ code: h.code, source: 'test' }),
    diagFetch: async (args) => {
      h.fetchCalls.push(args);
      if (h.fail) throw new Error('network down');
      const payload = h.payload;
      return { json: async () => payload };
    },
    now: () => h.now,
  });
  return h;
}

(async () => {
  // Two sequential calls inside the TTL → one network fetch, second is cached
  let h = makeHarness();
  const r1 = await h.feed.fetchRaw({ module: 'a' });
  const r2 = await h.feed.fetchRaw({ module: 'b' });
  check(h.fetchCalls.length === 1, 'second call within TTL served from memo (1 fetch)');
  check(r1.cached === false && r2.cached === true, 'cached flag distinguishes memo hits');
  check(r2.raw === r1.raw, 'memo returns the same payload object');

  // TTL expiry → refetch
  h.now += TTL_MS + 1;
  await h.feed.fetchRaw({ module: 'a' });
  check(h.fetchCalls.length === 2, 'TTL expiry triggers a fresh fetch');

  // Practice-code change → memo miss even inside TTL
  h.code = 'xyz789';
  await h.feed.fetchRaw({ module: 'a' });
  check(h.fetchCalls.length === 3, 'practice-code change bypasses the memo');
  check(h.fetchCalls[2].url.includes('xyz789'), 'URL is built from the freshly-resolved code');

  // Concurrent callers coalesce onto one in-flight fetch
  h = makeHarness();
  const [c1, c2, c3] = await Promise.all([
    h.feed.fetchRaw({ module: 'a' }),
    h.feed.fetchRaw({ module: 'b' }),
    h.feed.fetchRaw({ module: 'c' }),
  ]);
  check(h.fetchCalls.length === 1, 'three concurrent callers share one in-flight fetch');
  check(c1.raw === c2.raw && c2.raw === c3.raw, 'coalesced callers all get the payload');

  // Errors propagate and are NOT cached
  h = makeHarness();
  h.fail = true;
  let threw = false;
  try {
    await h.feed.fetchRaw({ module: 'a' });
  } catch (_) {
    threw = true;
  }
  check(threw, 'fetch failure propagates to the caller');
  h.fail = false;
  await h.feed.fetchRaw({ module: 'a' });
  check(h.fetchCalls.length === 2, 'a failure is not cached — next call refetches');

  // bypassCache forces a fetch AND refreshes the shared memo
  h = makeHarness();
  await h.feed.fetchRaw({ module: 'a' });
  h.payload = { schedule: { schedule: [{ entries: [] }] } };
  const rb = await h.feed.fetchRaw({ module: 'a', bypassCache: true });
  check(h.fetchCalls.length === 2, 'bypassCache forces a fresh fetch inside the TTL');
  check(rb.raw === h.payload, 'bypassCache returns the fresh payload');
  const rc = await h.feed.fetchRaw({ module: 'b' });
  check(rc.cached === true && rc.raw === h.payload, 'bypassCache refreshed the memo for other callers');

  // No practice code → no fetch, null raw
  h = makeHarness({ code: null });
  const rn = await h.feed.fetchRaw({ module: 'a' });
  check(rn.raw === null && rn.code === null, 'missing practice code returns null raw/code');
  check(h.fetchCalls.length === 0, 'missing practice code never hits the network');

  // ============================================================
  // Layer 2 — arrivedEntries filter
  // ============================================================
  console.log('Layer 2: arrivedEntries filter');

  const raw = {
    schedule: {
      schedule: [
        {
          entries: [
            { diaryEntryType: { value: 'appointment' }, displayStatus: { value: 'arrived' }, patient: { name: 'A' } },
            { diaryEntryType: { value: 'appointment' }, displayStatus: { value: 'booked' }, patient: { name: 'B' } },
            { diaryEntryType: { value: 'note' }, displayStatus: { value: 'arrived' }, patient: { name: 'C' } },
          ],
        },
        {
          entries: [
            { diaryEntryType: { value: 'appointment' }, displayStatus: { value: 'arrived' }, patient: { name: 'D' } },
          ],
        },
        {},
      ],
    },
  };
  const arrived = arrivedEntries(raw);
  check(arrived.length === 2, 'only arrived appointments pass the filter');
  check(arrived[0].patient.name === 'A' && arrived[1].patient.name === 'D', 'entries flattened across days in order');
  check(arrivedEntries(null).length === 0, 'null payload yields empty list');
  check(arrivedEntries({}).length === 0, 'shapeless payload yields empty list');

  // ============================================================
  // Layer 3 — wiring: consumers actually use the shared fetcher
  // ============================================================
  console.log('Layer 3: consumer wiring (no duplicated endpoint fetches)');

  const consumers = [
    ['side-panel/strips/waiting-room.js', 'panel-wr-strip'],
    ['side-panel/modules/sentinel/sentinel.js', 'sentinel-wr'],
    ['side-panel/modules/today/today.js', 'today-wr'],
  ];
  for (const [file, label] of consumers) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    check(src.includes('AppointmentsFeed.fetchRaw'), `${file} uses AppointmentsFeed.fetchRaw`);
    check(
      !src.includes('/scheduling/data/homepage/my-appointments'),
      `${file} no longer builds the my-appointments URL itself`
    );
    check(src.includes(label), `${file} keeps its '${label}' diag module label`);
  }
  for (const shell of ['side-panel/panel.html', 'pop-out/pop-out.html']) {
    const html = fs.readFileSync(path.join(__dirname, shell), 'utf8');
    check(html.includes('shared/appointments-feed.js'), `${shell} loads shared/appointments-feed.js`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
