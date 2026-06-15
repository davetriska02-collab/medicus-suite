// Medicus Suite — API client contract tests
// Run with: node test-api-clients.js
//
// Pins the error/success contracts of:
//   shared/medicus-api.js   (ES module — loaded via dynamic import())
//   shared/referrals-api.js (IIFE with module.exports fallback — loaded via require())
//   shared/activity-api.js  (IIFE with module.exports fallback — loaded via require())
//
// For each main fetch function we test:
//   • Validation errors (missing/invalid args) — must throw synchronously / reject
//   • HTTP 401/403 — contract differs per client (see table below)
//   • HTTP 500 — all clients throw
//   • Network rejection (fetch rejects with TypeError) — must propagate
//   • Malformed JSON (response.json() rejects) — must propagate
//   • Happy path — returns expected shape
//   • fetchManyDates: per-date error boxing into { error: string }
//
// Contract summary (pinned current behaviour):
//
//   fetchSchedulingOverview (medicus-api.js):
//     siteId falsy            → throws Error('Practice code not set')
//     siteId invalid format   → throws Error('Invalid practice code format: ...')
//     401/403                 → throws Error('Not signed in to Medicus')
//     500                     → throws Error('API error 500')
//     network rejection       → propagates TypeError
//     bad JSON                → propagates SyntaxError / rejection
//     happy path              → returns raw JSON payload; caches it
//
//   fetchReferrals (referrals-api.js):
//     no startDate/endDate    → throws Error('Date range required')
//     no templateUrl + code   → builds canonical URL from practice code and fetches
//     no templateUrl + no code → throws Error('… no practice code …')
//     401/403                 → throws Error('HTTP 401') with err.status = 401
//     500                     → throws Error('HTTP 500') with err.status = 500
//     network rejection       → propagates TypeError (NOTE: unhandled rejection danger — see below)
//     bad JSON                → propagates rejection (NOTE: same danger)
//     config response         → throws Error('Got config response …')
//     happy path              → { referrals, totalCount, url }
//
//   fetchActivityReport (activity-api.js):
//     no practiceCode         → throws Error('No practice code')
//     invalid practiceCode    → throws Error('Invalid practice code format: ...')
//     no dates                → throws Error('Date range required')
//     401/403                 → throws Error('HTTP 401')  [no special auth message]
//     500                     → throws Error('HTTP 500')
//     network rejection       → propagates TypeError
//     bad JSON                → propagates rejection
//     happy path              → returns raw API JSON payload

'use strict';

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

// Helper: expect an async function to reject, and optionally check the message
async function expectReject(fn, msgFragment, label) {
  try {
    await fn();
    check(false, `${label} — expected rejection but resolved`);
  } catch (e) {
    if (msgFragment) {
      check(
        typeof e.message === 'string' && e.message.includes(msgFragment),
        `${label} — rejects with "${msgFragment}" (got: "${e.message}")`
      );
    } else {
      check(true, `${label} — rejects as expected`);
    }
  }
}

// Helper: build a minimal mock Response
function mockResponse(status, jsonPayload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonPayload instanceof Error) throw jsonPayload;
      return jsonPayload;
    },
    text: async () =>
      jsonPayload && typeof jsonPayload === 'object' ? JSON.stringify(jsonPayload) : String(jsonPayload || ''),
  };
}

// ── medicus-api.js (ES module) ────────────────────────────────────────────────
//
// We cannot require() an ES module.  Use dynamic import() via a file:// URL.
// The module uses the global `fetch` function directly (not opts.fetch), so we
// patch globalThis.fetch in the main process for each test and restore it after.
// The module-level _cache Map is shared across all tests in the same import;
// we bypass it by using siteId combos that haven't been fetched before, or by
// using bypassCache:true where appropriate.

async function runMedicusApiTests() {
  console.log('\n=== medicus-api.js ===');

  const modUrl = new URL('shared/medicus-api.js', `file://${process.cwd()}/`).href;
  let MedicusApi;
  try {
    MedicusApi = await import(modUrl);
    check(typeof MedicusApi.fetchSchedulingOverview === 'function', 'medicus-api.js imported successfully');
  } catch (e) {
    check(false, `medicus-api.js import failed: ${e.message}`);
    return;
  }

  const { fetchSchedulingOverview, fetchManyDates, fetchAppointmentTypes } = MedicusApi;

  // Save + restore globalThis.fetch around each test
  const origFetch = globalThis.fetch;
  function setFetch(fn) {
    globalThis.fetch = fn;
  }
  function restoreFetch() {
    globalThis.fetch = origFetch;
  }

  // ── Validation (no network needed) ───────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: input validation ---');

  await expectReject(() => fetchSchedulingOverview(null, '2026-01-01'), 'Practice code not set', 'null siteId throws');
  await expectReject(() => fetchSchedulingOverview('', '2026-01-01'), 'Practice code not set', 'empty siteId throws');
  await expectReject(
    () => fetchSchedulingOverview('not-hex!!', '2026-01-01'),
    'Invalid practice code format',
    'invalid siteId format throws'
  );
  await expectReject(
    () => fetchSchedulingOverview('toolonghexvalueXXXX', '2026-01-01'),
    'Invalid practice code format',
    'over-length siteId (9 chars) throws'
  );

  // ── HTTP 401 ─────────────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: HTTP 401 ---');
  setFetch(async () => mockResponse(401, {}));
  await expectReject(
    () => fetchSchedulingOverview('a1b2c3', '2026-01-01'),
    'Not signed in to Medicus',
    '401 → "Not signed in to Medicus"'
  );
  restoreFetch();

  // ── HTTP 403 ─────────────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: HTTP 403 ---');
  setFetch(async () => mockResponse(403, {}));
  await expectReject(
    () => fetchSchedulingOverview('a1b2c3d', '2026-01-02'),
    'Not signed in to Medicus',
    '403 → "Not signed in to Medicus"'
  );
  restoreFetch();

  // ── HTTP 500 ─────────────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: HTTP 500 ---');
  setFetch(async () => mockResponse(500, {}));
  await expectReject(() => fetchSchedulingOverview('a1b2c3', '2026-01-03'), 'API error 500', '500 → "API error 500"');
  restoreFetch();

  // ── Network rejection ─────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: network rejection ---');
  setFetch(async () => {
    throw new TypeError('Failed to fetch');
  });
  await expectReject(
    () => fetchSchedulingOverview('a1b2c3', '2026-01-04'),
    'Failed to fetch',
    'network TypeError propagates'
  );
  restoreFetch();

  // ── Malformed JSON ────────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: malformed JSON ---');
  setFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  }));
  await expectReject(
    () => fetchSchedulingOverview('a1b2c3', '2026-01-05'),
    'Unexpected token',
    'bad JSON propagates SyntaxError'
  );
  restoreFetch();

  // ── Happy path ────────────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: happy path ---');
  const happyPayload = {
    staffSchedules: [
      {
        name: 'Dr Smith',
        schedule: [
          {
            summary: { status: { isCancelled: false } },
            entries: [
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'GP Standard' },
                startDateTime: '2099-01-01T10:00:00',
              },
            ],
          },
        ],
      },
    ],
    appointmentTypeOptions: [{ value: 'gp', label: 'GP Standard' }],
  };

  let fetchCalled = false;
  setFetch(async () => {
    fetchCalled = true;
    return mockResponse(200, happyPayload);
  });

  let result;
  try {
    result = await fetchSchedulingOverview('a1b2c3', '2026-01-06');
    check(fetchCalled, 'happy path: fetch was called');
    check(Array.isArray(result.staffSchedules), 'happy path: returns object with staffSchedules array');
    check(result.staffSchedules[0].name === 'Dr Smith', 'happy path: staffSchedules[0].name correct');
    check(Array.isArray(result.appointmentTypeOptions), 'happy path: appointmentTypeOptions present');
  } catch (e) {
    check(false, `happy path: unexpected rejection: ${e.message}`);
  }
  restoreFetch();

  // ── Cache behaviour ───────────────────────────────────────────────────────

  console.log('\n--- fetchSchedulingOverview: caching ---');
  let callCount = 0;
  setFetch(async () => {
    callCount++;
    return mockResponse(200, { staffSchedules: [], appointmentTypeOptions: [] });
  });

  // Use a unique date to avoid hitting cache from previous tests
  await fetchSchedulingOverview('a1b2c3', '2099-06-01');
  await fetchSchedulingOverview('a1b2c3', '2099-06-01'); // second call — should be cached
  check(callCount === 1, 'second call to same siteId+date is served from cache (no second fetch)');

  // bypassCache:true forces a fresh fetch
  await fetchSchedulingOverview('a1b2c3', '2099-06-01', { bypassCache: true });
  check(callCount === 2, 'bypassCache:true skips cache and fetches again');
  restoreFetch();

  // ── fetchManyDates: per-date error boxing ─────────────────────────────────

  console.log('\n--- fetchManyDates: error boxing ---');

  // Two dates: one succeeds, one 500-errors
  setFetch(async (url) => {
    if (url.includes('2026-02-01')) return mockResponse(200, { staffSchedules: [] });
    return mockResponse(500, {});
  });

  let manyResult;
  try {
    manyResult = await fetchManyDates('b2c3d4', ['2026-02-01', '2026-02-02'], { concurrency: 1 });
    check(typeof manyResult === 'object', 'fetchManyDates: returns an object keyed by date');
    check(manyResult['2026-02-01'] && !manyResult['2026-02-01'].error, 'fetchManyDates: successful date has no .error');
    check(typeof manyResult['2026-02-02']?.error === 'string', 'fetchManyDates: 500 is boxed into { error: string }');
    check(manyResult['2026-02-02'].error.includes('API error 500'), 'fetchManyDates: error message includes status');
  } catch (e) {
    check(false, `fetchManyDates: unexpected throw: ${e.message}`);
  }
  restoreFetch();

  // Network rejection is also boxed
  setFetch(async () => {
    throw new TypeError('net::ERR_NAME_NOT_RESOLVED');
  });
  try {
    manyResult = await fetchManyDates('b2c3d4', ['2026-03-01'], { concurrency: 1 });
    check(
      typeof manyResult['2026-03-01']?.error === 'string',
      'fetchManyDates: network error boxed into { error: string }'
    );
  } catch (e) {
    check(false, `fetchManyDates: network error should be boxed, not thrown: ${e.message}`);
  }
  restoreFetch();

  // ── fetchAppointmentTypes: returns [] on error ────────────────────────────

  console.log('\n--- fetchAppointmentTypes: graceful degradation ---');

  setFetch(async () => mockResponse(500, {}));
  try {
    const types = await fetchAppointmentTypes('a1b2c3');
    check(Array.isArray(types) && types.length === 0, 'fetchAppointmentTypes: returns [] when API errors');
  } catch (e) {
    check(false, `fetchAppointmentTypes: should not throw on API error (got: ${e.message})`);
  }
  restoreFetch();

  setFetch(async () =>
    mockResponse(200, {
      staffSchedules: [],
      appointmentTypeOptions: [
        { value: 'gp', label: 'GP Standard' },
        { value: 'nurse', label: 'Nurse' },
      ],
    })
  );
  try {
    const types = await fetchAppointmentTypes('a1b2c3');
    check(Array.isArray(types) && types.length === 2, 'fetchAppointmentTypes: returns mapped types array');
    check(types[0].id && types[0].name, 'fetchAppointmentTypes: each entry has { id, name }');
    // Should be sorted by name (alphabetical)
    check(types[0].name <= types[1].name, 'fetchAppointmentTypes: sorted alphabetically by name');
  } catch (e) {
    check(false, `fetchAppointmentTypes: unexpected throw: ${e.message}`);
  }
  restoreFetch();
}

// ── referrals-api.js (IIFE / module.exports) ──────────────────────────────────
//
// Loaded via require(). fetchReferrals accepts opts.fetch so no globalThis patching needed.
// The function throws (propagates) on all HTTP errors — callers use Promise.allSettled
// or try/catch to absorb them.
//
// NOTE: If fetchImpl (opts.fetch) rejects with a network error, the rejection escapes
// fetchReferrals uncaught — there is no try/catch wrapper inside the function around
// the fetchImpl() call. The callers (referrals.js) use Promise.allSettled which absorbs
// the rejection, so it does not propagate to the top level in production.
// However, a caller that awaits fetchReferrals() directly without try/catch will see an
// unhandled rejection.  This is flagged below as DANGER-1.

async function runReferralsApiTests() {
  console.log('\n=== referrals-api.js ===');

  let ReferralsApi;
  try {
    ReferralsApi = require('./shared/referrals-api.js');
    check(typeof ReferralsApi.fetchReferrals === 'function', 'referrals-api.js loaded via require()');
  } catch (e) {
    check(false, `referrals-api.js require failed: ${e.message}`);
    return;
  }

  const { fetchReferrals } = ReferralsApi;

  const TEMPLATE_URL =
    'https://a1b2c3.api.england.medicus.health/referrals/clinical-audit-report?referralStartDate=2026-01-01&referralEndDate=2026-01-31&startRow=0&endRow=2000';

  // ── Input validation ──────────────────────────────────────────────────────

  console.log('\n--- fetchReferrals: input validation ---');

  await expectReject(
    () => fetchReferrals('a1b2c3', null, '2026-01-31', { fetch: async () => mockResponse(200, {}) }),
    'Date range required',
    'null startDate → "Date range required"'
  );
  await expectReject(
    () => fetchReferrals('a1b2c3', '2026-01-01', null, { fetch: async () => mockResponse(200, {}) }),
    'Date range required',
    'null endDate → "Date range required"'
  );
  // No templateUrl but a practice code → builds the canonical endpoint and fetches.
  let canonUrl = null;
  try {
    const res = await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async (url) => {
        canonUrl = url;
        return mockResponse(200, { referrals: [], totalCount: 0 });
      },
    });
    check(Array.isArray(res.referrals), 'no templateUrl + code → resolves (canonical fallback)');
    check(
      typeof canonUrl === 'string' && canonUrl.includes('a1b2c3.api.england.medicus.health/referrals/clinical-audit-report'),
      'no templateUrl + code → canonical URL built from practice code'
    );
  } catch (e) {
    check(false, `canonical fallback: unexpected rejection: ${e.message}`);
  }
  // No templateUrl AND no code → cannot build a URL, rejects.
  await expectReject(
    () => fetchReferrals('', '2026-01-01', '2026-01-31', { fetch: async () => mockResponse(200, {}) }),
    'no practice code',
    'no templateUrl and no code → rejects'
  );

  // ── HTTP 401 ──────────────────────────────────────────────────────────────

  console.log('\n--- fetchReferrals: HTTP 401 ---');

  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => mockResponse(401, ''),
    });
    check(false, '401 should throw');
  } catch (e) {
    check(e.message.includes('401'), `401 → throws with "401" in message (got: "${e.message}")`);
    check(e.status === 401, `401 → err.status === 401`);
  }

  // ── HTTP 403 ──────────────────────────────────────────────────────────────

  console.log('\n--- fetchReferrals: HTTP 403 ---');

  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => mockResponse(403, ''),
    });
    check(false, '403 should throw');
  } catch (e) {
    check(e.message.includes('403'), `403 → throws with "403" in message (got: "${e.message}")`);
    check(e.status === 403, `403 → err.status === 403`);
  }

  // ── HTTP 500 ──────────────────────────────────────────────────────────────

  console.log('\n--- fetchReferrals: HTTP 500 ---');

  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => mockResponse(500, 'Internal Server Error'),
    });
    check(false, '500 should throw');
  } catch (e) {
    check(e.message.includes('500'), `500 → throws with "500" in message`);
    check(e.status === 500, `500 → err.status === 500`);
    check(typeof e.url === 'string', `500 → err.url is set`);
    check(typeof e.body === 'string', `500 → err.body is set`);
  }

  // ── Network rejection ─────────────────────────────────────────────────────
  //
  // NOTE (DANGER-1): fetchReferrals has no try/catch around its fetchImpl() call.
  // The TypeError from a network failure propagates out of fetchReferrals as an
  // unhandled rejection.  The production caller (referrals.js) uses Promise.allSettled
  // which absorbs it safely.  Any direct caller without try/catch is at risk.

  console.log('\n--- fetchReferrals: network rejection ---');

  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => {
        throw new TypeError('net::ERR_NAME_NOT_RESOLVED');
      },
    });
    check(false, 'network rejection should propagate');
  } catch (e) {
    // NOTE (DANGER-1): raw TypeError escapes — no wrapping in a typed error
    check(e instanceof TypeError, 'network rejection: raw TypeError propagates (not wrapped) — see DANGER-1');
    check(e.message.includes('ERR_NAME_NOT_RESOLVED'), 'network rejection: original message preserved');
  }

  // ── Malformed JSON ────────────────────────────────────────────────────────
  //
  // NOTE (DANGER-1 continued): same unhandled-rejection risk applies here.

  console.log('\n--- fetchReferrals: malformed JSON ---');

  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
        text: async () => '',
      }),
    });
    check(false, 'malformed JSON should propagate');
  } catch (e) {
    check(e instanceof SyntaxError, 'malformed JSON: SyntaxError propagates unwrapped — see DANGER-1');
  }

  // ── Config response (wrong endpoint) ─────────────────────────────────────

  console.log('\n--- fetchReferrals: config response guard ---');

  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => mockResponse(200, { priorityOptions: ['Routine'], statusOptions: [] }),
    });
    check(false, 'config response should throw');
  } catch (e) {
    check(e.message.includes('Got config response'), `config response → "Got config response …" (got: "${e.message}")`);
  }

  // ── Happy path — single page ──────────────────────────────────────────────

  console.log('\n--- fetchReferrals: happy path ---');

  const mockReferral = {
    referralId: 'ref-001',
    referralDate: '2026-01-10',
    referralService: 'Cardiology – Cardiology – Royal Free – RFL',
    referringClinician: 'Dr Jones',
    priority: 'Routine',
    displayStatus: 'Completed',
    isManualReferral: false,
    isNhsEReferral: true,
    patientGivenName: 'Alice',
    patientFamilyName: 'Smith',
  };

  try {
    const res = await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => mockResponse(200, { referrals: [mockReferral], totalCount: 1 }),
    });
    check(Array.isArray(res.referrals), 'happy path: result.referrals is array');
    check(res.referrals.length === 1, 'happy path: result.referrals has 1 item');
    check(res.totalCount === 1, 'happy path: result.totalCount === 1');
    check(typeof res.url === 'string', 'happy path: result.url is string');
    check(res.referrals[0].referralId === 'ref-001', 'happy path: referral data preserved');
  } catch (e) {
    check(false, `happy path: unexpected rejection: ${e.message}`);
  }

  // ── Happy path — pagination stops when page is short ─────────────────────

  console.log('\n--- fetchReferrals: pagination termination ---');

  let pageFetchCount = 0;
  try {
    const res = await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => {
        pageFetchCount++;
        // First page returns fewer rows than PAGE_SIZE (2000) → should stop
        return mockResponse(200, { referrals: [mockReferral], totalCount: 1 });
      },
    });
    check(pageFetchCount === 1, 'pagination: short page stops after first fetch');
    check(res.referrals.length === 1, 'pagination: all referrals collected');
  } catch (e) {
    check(false, `pagination: unexpected rejection: ${e.message}`);
  }

  // ── onProgress callback ───────────────────────────────────────────────────

  console.log('\n--- fetchReferrals: onProgress callback ---');

  let progressCalls = 0;
  try {
    await fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
      templateUrl: TEMPLATE_URL,
      fetch: async () => mockResponse(200, { referrals: [mockReferral], totalCount: 1 }),
      onProgress: () => {
        progressCalls++;
      },
    });
    check(progressCalls >= 1, 'onProgress: called at least once per page');
  } catch (e) {
    check(false, `onProgress: unexpected rejection: ${e.message}`);
  }

  // ── buildCanonicalUrl ─────────────────────────────────────────────────────

  console.log('\n--- buildCanonicalUrl ---');
  const { buildCanonicalUrl } = ReferralsApi;
  const cu = buildCanonicalUrl('a1b2c3', '2026-01-01', '2026-01-31');
  check(
    typeof cu === 'string' && cu.startsWith('https://a1b2c3.api.england.medicus.health/referrals/clinical-audit-report?'),
    'buildCanonicalUrl: correct host + path'
  );
  check(cu.includes('referralStartDate=2026-01-01') && cu.includes('referralEndDate=2026-01-31'), 'buildCanonicalUrl: date params');
  check(cu.includes('priorities%5B%5D=TwoWeekWait') || cu.includes('priorities[]=TwoWeekWait'), 'buildCanonicalUrl: priorities included');
  check(buildCanonicalUrl('', '2026-01-01', '2026-01-31') === null, 'buildCanonicalUrl: no code → null');
  // Red-team: a poisoned practice code (e.g. from a malicious backup) must not reach the URL host.
  check(buildCanonicalUrl('evil.com#', '2026-01-01', '2026-01-31') === null, 'buildCanonicalUrl: code with host-injection chars → null');
  check(buildCanonicalUrl('a1b2c3/x', '2026-01-01', '2026-01-31') === null, 'buildCanonicalUrl: code with slash → null');
  check(buildCanonicalUrl('a1b2c3.evil', '2026-01-01', '2026-01-31') === null, 'buildCanonicalUrl: code with dot → null');

  // ── host allowlist (refuse non-Medicus fetch) ─────────────────────────────

  console.log('\n--- fetchReferrals: host allowlist ---');
  await expectReject(
    () =>
      fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
        templateUrl: 'https://evil.com/referrals/clinical-audit-report?referralStartDate=2026-01-01&referralEndDate=2026-01-31&startRow=0&endRow=2000',
        fetch: async () => mockResponse(200, { referrals: [], totalCount: 0 }),
      }),
    'non-Medicus host',
    'poisoned templateUrl host → rejects before any fetch'
  );
  await expectReject(
    () =>
      fetchReferrals('a1b2c3', '2026-01-01', '2026-01-31', {
        templateUrl: 'https://api.england.medicus.health.evil.com/referrals/clinical-audit-report?startRow=0&endRow=2000',
        fetch: async () => mockResponse(200, { referrals: [], totalCount: 0 }),
      }),
    'non-Medicus host',
    'look-alike suffix host → rejects'
  );

  // ── shared cache (cacheGet / cachePut / cacheClear) ───────────────────────

  console.log('\n--- shared cache ---');
  const { cacheGet, cachePut, cacheClear } = ReferralsApi;
  cacheClear();
  check(cacheGet('a1b2c3', '2026-01-01', '2026-01-31', 60000) === null, 'cacheGet: empty → null');
  const rows = [{ referralId: 'x' }];
  cachePut('a1b2c3', '2025-06-15', '2026-06-15', rows); // 12-month window
  check(cacheGet('a1b2c3', '2026-01-01', '2026-01-31', 60000) === rows, 'cacheGet: cached range CONTAINS request → hit');
  check(cacheGet('a1b2c3', '2024-01-01', '2026-06-15', 60000) === null, 'cacheGet: request wider than cache → miss (no silent drop)');
  check(cacheGet('other', '2026-01-01', '2026-01-31', 60000) === null, 'cacheGet: different practice code → miss');
  check(cacheGet('a1b2c3', '2026-01-01', '2026-01-31', -1) === null, 'cacheGet: stale (negative TTL) → miss');
  cacheClear();
  check(cacheGet('a1b2c3', '2026-01-01', '2026-01-31', 60000) === null, 'cacheClear: drops the cache');
}

// ── activity-api.js (IIFE / module.exports) ───────────────────────────────────
//
// Loaded via require(). fetchActivityReport accepts opts.fetch.
// On HTTP errors it throws Error('HTTP <status>') — no special 401/403 message.
// Network and JSON errors propagate unwrapped (same risk pattern as referrals-api).
//
// NOTE (DANGER-2): fetchActivityReport has no try/catch around fetchImpl() or r.json().
// Network TypeErrors and JSON SyntaxErrors escape unwrapped.  In production,
// activity.js catches them via try/catch, and referrals.js via Promise.allSettled.
// Any direct caller without error handling is at risk.

async function runActivityApiTests() {
  console.log('\n=== activity-api.js ===');

  let ActivityApi;
  try {
    ActivityApi = require('./shared/activity-api.js');
    check(typeof ActivityApi.fetchActivityReport === 'function', 'activity-api.js loaded via require()');
  } catch (e) {
    check(false, `activity-api.js require failed: ${e.message}`);
    return;
  }

  const { fetchActivityReport } = ActivityApi;

  // ── Input validation ──────────────────────────────────────────────────────

  console.log('\n--- fetchActivityReport: input validation ---');

  await expectReject(
    () => fetchActivityReport(null, '2026-01-01', '2026-01-31', { fetch: async () => {} }),
    'No practice code',
    'null practiceCode → "No practice code"'
  );
  await expectReject(
    () => fetchActivityReport('', '2026-01-01', '2026-01-31', { fetch: async () => {} }),
    'No practice code',
    'empty practiceCode → "No practice code"'
  );
  await expectReject(
    () => fetchActivityReport('not-hex!!', '2026-01-01', '2026-01-31', { fetch: async () => {} }),
    'Invalid practice code format',
    'invalid practiceCode format → "Invalid practice code format"'
  );
  await expectReject(
    () => fetchActivityReport('a1b2c3', null, '2026-01-31', { fetch: async () => {} }),
    'Date range required',
    'null startDate → "Date range required"'
  );
  await expectReject(
    () => fetchActivityReport('a1b2c3', '2026-01-01', null, { fetch: async () => {} }),
    'Date range required',
    'null endDate → "Date range required"'
  );

  // ── HTTP 401 ──────────────────────────────────────────────────────────────

  console.log('\n--- fetchActivityReport: HTTP 401 ---');

  try {
    await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => mockResponse(401, {}),
    });
    check(false, '401 should throw');
  } catch (e) {
    // NOTE: activity-api.js does NOT produce a user-friendly "Not signed in" message.
    // It throws a generic "HTTP 401".  This differs from medicus-api.js.
    check(e.message === 'HTTP 401', `401 → throws "HTTP 401" exactly (got: "${e.message}")`);
  }

  // ── HTTP 403 ──────────────────────────────────────────────────────────────

  console.log('\n--- fetchActivityReport: HTTP 403 ---');

  try {
    await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => mockResponse(403, {}),
    });
    check(false, '403 should throw');
  } catch (e) {
    check(e.message === 'HTTP 403', `403 → throws "HTTP 403" exactly (got: "${e.message}")`);
  }

  // ── HTTP 500 ──────────────────────────────────────────────────────────────

  console.log('\n--- fetchActivityReport: HTTP 500 ---');

  try {
    await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => mockResponse(500, {}),
    });
    check(false, '500 should throw');
  } catch (e) {
    check(e.message === 'HTTP 500', `500 → throws "HTTP 500" exactly (got: "${e.message}")`);
  }

  // ── Network rejection ─────────────────────────────────────────────────────
  //
  // NOTE (DANGER-2): raw TypeError escapes; not wrapped by fetchActivityReport.

  console.log('\n--- fetchActivityReport: network rejection ---');

  try {
    await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => {
        throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
      },
    });
    check(false, 'network rejection should propagate');
  } catch (e) {
    check(e instanceof TypeError, 'network rejection: raw TypeError propagates (not wrapped) — see DANGER-2');
    check(e.message.includes('ERR_INTERNET_DISCONNECTED'), 'network rejection: original message preserved');
  }

  // ── Malformed JSON ────────────────────────────────────────────────────────
  //
  // NOTE (DANGER-2 continued)

  console.log('\n--- fetchActivityReport: malformed JSON ---');

  try {
    await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Bad JSON');
        },
      }),
    });
    check(false, 'malformed JSON should propagate');
  } catch (e) {
    check(e instanceof SyntaxError, 'malformed JSON: SyntaxError propagates unwrapped — see DANGER-2');
  }

  // ── Happy path ────────────────────────────────────────────────────────────

  console.log('\n--- fetchActivityReport: happy path ---');

  const mockActivityPayload = {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    rowData: [
      {
        name: 'Dr Smith',
        consultations: 42,
        routinePrescriptionRequestTasks: 10,
        nonRoutinePrescriptionRequestTasks: 2,
        medicationReviews: 5,
        documentTasks: 8,
        investigationReportTasks: 3,
      },
    ],
  };

  try {
    const data = await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => mockResponse(200, mockActivityPayload),
    });
    check(typeof data === 'object' && data !== null, 'happy path: returns object');
    check(data.startDate === '2026-01-01', 'happy path: startDate present');
    check(data.endDate === '2026-01-31', 'happy path: endDate present');
    check(Array.isArray(data.rowData), 'happy path: rowData is array');
    check(data.rowData.length === 1, 'happy path: rowData has 1 row');
    check(data.rowData[0].name === 'Dr Smith', 'happy path: rowData[0].name correct');
    check(data.rowData[0].consultations === 42, 'happy path: consultations count correct');
  } catch (e) {
    check(false, `happy path: unexpected rejection: ${e.message}`);
  }

  // ── opts.fetch takes precedence over global fetch ─────────────────────────

  console.log('\n--- fetchActivityReport: opts.fetch preferred over global ---');

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('global fetch must not be called');
  };
  let optsFetchCalled = false;
  try {
    await fetchActivityReport('a1b2c3', '2026-01-01', '2026-01-31', {
      fetch: async () => {
        optsFetchCalled = true;
        return mockResponse(200, mockActivityPayload);
      },
    });
    check(optsFetchCalled, 'opts.fetch is preferred when provided');
  } catch (e) {
    check(false, `opts.fetch preference test: unexpected error: ${e.message}`);
  }
  globalThis.fetch = origFetch;
}

// ── Pure utility functions (no fetch) ────────────────────────────────────────

async function runUtilityTests() {
  console.log('\n=== Pure utility functions ===');

  // medicus-api.js utilities (already imported above in runMedicusApiTests)
  const modUrl = new URL('shared/medicus-api.js', `file://${process.cwd()}/`).href;
  const MA = await import(modUrl);

  console.log('\n--- medicus-api.js: aggregateSlots ---');
  const rawData = {
    staffSchedules: [
      {
        name: 'Dr A',
        schedule: [
          {
            summary: { status: { isCancelled: false } },
            entries: [
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'GP' },
                startDateTime: '2099-01-01T09:00:00',
              },
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'GP' },
                startDateTime: '2099-01-01T14:00:00',
              },
              { diaryEntryType: { value: 'admin' }, appointmentType: { name: 'Admin' } }, // should be ignored
            ],
          },
        ],
      },
    ],
  };

  const agg = MA.aggregateSlots(rawData);
  check(agg.total === 2, 'aggregateSlots: total counts only slots');
  check(agg.byType['GP'] === 2, 'aggregateSlots: byType[GP] === 2');
  check(Array.isArray(agg.byStaff) && agg.byStaff.length === 1, 'aggregateSlots: byStaff has one entry');
  check(agg.byStaff[0].name === 'Dr A', 'aggregateSlots: byStaff[0].name correct');
  check(agg.sessionsCount === 1, 'aggregateSlots: sessionsCount counts non-cancelled sessions');

  // Type whitelist filter
  const aggFiltered = MA.aggregateSlots(rawData, { allowedTypes: ['Nurse'] });
  check(aggFiltered.total === 0, 'aggregateSlots: allowedTypes filter excludes non-matching types');

  console.log('\n--- medicus-api.js: computeStatus ---');
  check(MA.computeStatus(10, 8) === 'sufficient', 'computeStatus: count >= minimum → sufficient');
  check(MA.computeStatus(7, 8) === 'tight', 'computeStatus: 87.5% → tight (>= 75%)');
  check(MA.computeStatus(5, 8) === 'low', 'computeStatus: 62.5% → low (>= 50%)');
  check(MA.computeStatus(2, 8) === 'critical', 'computeStatus: 25% → critical (< 50%)');
  check(MA.computeStatus(0, 0) === 'sufficient', 'computeStatus: 0/0 → sufficient (100%)');

  console.log('\n--- referrals-api.js: parseReferralService ---');
  const RA = require('./shared/referrals-api.js');
  const parsed = RA.parseReferralService('Cardiology – Cardiology – Royal Free – RFL');
  check(parsed.service === 'Cardiology', 'parseReferralService: service extracted');
  check(parsed.specialty === 'Cardiology', 'parseReferralService: specialty extracted');
  check(parsed.hospital === 'Royal Free', 'parseReferralService: hospital extracted');
  check(parsed.trustCode === 'RFL', 'parseReferralService: trustCode extracted');

  const parsedHyphen = RA.parseReferralService('Ortho - Orthopaedics - St Thomas - GSTT');
  check(parsedHyphen.service === 'Ortho', 'parseReferralService: handles plain hyphen separator');

  const parsedEmpty = RA.parseReferralService(null);
  check(parsedEmpty.service === '(unknown)', 'parseReferralService: null → (unknown)');

  console.log('\n--- referrals-api.js: normalisePriority ---');
  check(RA.normalisePriority('Routine') === 'Routine', 'normalisePriority: Routine passthrough');
  check(RA.normalisePriority('routine') === 'Routine', 'normalisePriority: lowercase normalised');
  check(RA.normalisePriority('Urgent') === 'Urgent', 'normalisePriority: Urgent passthrough');
  check(RA.normalisePriority('urgent') === 'Urgent', 'normalisePriority: lowercase urgent normalised');
  check(RA.normalisePriority('TwoWeekWait') === 'TwoWeekWait', 'normalisePriority: TwoWeekWait passthrough');
  check(RA.normalisePriority('Two Week Wait') === 'TwoWeekWait', 'normalisePriority: "Two Week Wait" normalised');
  check(RA.normalisePriority('2WW') === 'TwoWeekWait', 'normalisePriority: 2WW normalised');
  check(RA.normalisePriority('') === '', 'normalisePriority: empty string passthrough');

  console.log('\n--- referrals-api.js: aggregate ---');
  const aggResult = RA.aggregate([
    {
      referringClinician: 'Dr Jones',
      referralService: 'Cardio – Cardiology – RFH – RFL',
      priority: 'Routine',
      displayStatus: 'Completed',
    },
    {
      referringClinician: 'Dr Jones',
      referralService: 'Ortho – Orthopaedics – RFH – RFL',
      priority: 'Urgent',
      displayStatus: 'Incomplete',
    },
    {
      referringClinician: 'Dr Smith',
      referralService: 'Cardio – Cardiology – RFH – RFL',
      priority: 'TwoWeekWait',
      displayStatus: 'Cancelled',
    },
  ]);
  check(aggResult.total === 3, 'aggregate: total === 3');
  check(aggResult.byClinician[0].name === 'Dr Jones', 'aggregate: byClinician sorted desc by count');
  check(aggResult.byClinician[0].count === 2, 'aggregate: Dr Jones count === 2');
  check(aggResult.byPriority.Routine === 1, 'aggregate: byPriority.Routine === 1');
  check(aggResult.byPriority.Urgent === 1, 'aggregate: byPriority.Urgent === 1');
  check(aggResult.byPriority.TwoWeekWait === 1, 'aggregate: byPriority.TwoWeekWait === 1');
  check(aggResult.byStatus.Completed === 1, 'aggregate: byStatus.Completed === 1');
  check(aggResult.byStatus.Cancelled === 1, 'aggregate: byStatus.Cancelled === 1');

  console.log('\n--- activity-api.js: aggregate ---');
  const AA = require('./shared/activity-api.js');
  const actAgg = AA.aggregate([
    {
      name: 'Dr A',
      consultations: 10,
      routinePrescriptionRequestTasks: 5,
      nonRoutinePrescriptionRequestTasks: 1,
      medicationReviews: 2,
      documentTasks: 3,
      investigationReportTasks: 4,
    },
    {
      name: 'Dr B',
      consultations: 20,
      routinePrescriptionRequestTasks: 8,
      nonRoutinePrescriptionRequestTasks: 0,
      medicationReviews: 1,
      documentTasks: 2,
      investigationReportTasks: 1,
    },
  ]);
  check(Array.isArray(actAgg.users) && actAgg.users.length === 2, 'activity aggregate: users array has 2 entries');
  check(actAgg.users[0].name === 'Dr B', 'activity aggregate: users sorted desc by total (Dr B first)');
  check(actAgg.totals.consultations === 30, 'activity aggregate: totals.consultations summed correctly');
  check(
    actAgg.totals.all === actAgg.users.reduce((s, u) => s + u.total, 0),
    'activity aggregate: totals.all matches sum of user totals'
  );
  check(actAgg.maxUserTotal === actAgg.users[0].total, 'activity aggregate: maxUserTotal is highest user total');
  check(AA.aggregate([]).users.length === 0, 'activity aggregate: empty array → empty users');
  check(AA.aggregate(null).users.length === 0, 'activity aggregate: null → empty users');
}

// ── engine/api-client.js (IIFE / module.exports) ──────────────────────────────
//
// Loaded via require(). Uses globalThis.fetch (same-origin credentials pattern).
// We patch globalThis.fetch around each test and restore it.
//
// fetchInvestigationReport(apiBase, overviewURL):
//   invalid overviewURL   → rejects with Error('bad overviewURL'), fetch NOT called
//   happy path            → resolves with the JSON payload
//   cache hit             → second call returns same data without a second fetch

async function runApiClientTests() {
  console.log('\n=== engine/api-client.js ===');

  let ApiClient;
  try {
    ApiClient = require('./engine/api-client.js');
    check(typeof ApiClient.fetchInvestigationReport === 'function', 'api-client.js loaded via require()');
  } catch (e) {
    check(false, `api-client.js require failed: ${e.message}`);
    return;
  }

  const { fetchInvestigationReport, clearCache } = ApiClient;
  const API_BASE = 'https://560b6c.api.england.medicus.health';
  const VALID_URL = '/tasks/data/review-investigation-report/overview/aaaabbbb-0000-0000-0000-000000000001';

  const origFetch = globalThis.fetch;
  function setFetch(fn) {
    globalThis.fetch = fn;
  }
  function restoreFetch() {
    globalThis.fetch = origFetch;
  }

  // ── Input validation — fetch must NOT be called ───────────────────────────

  console.log('\n--- fetchInvestigationReport: input validation ---');

  const invalidCases = [
    ['https://evil.com/tasks/data/x/overview/uuid', 'absolute URL (contains ://)'],
    ['/tasks/data/../etc/passwd', 'path traversal (..)'],
    ['/clinical/data/x/overview/uuid', 'wrong prefix (not /tasks/data/)'],
    ['/tasks/data/x/no-overview/uuid', 'missing /overview/ segment'],
    ['/tasks/data/x/overview /uuid', 'whitespace in path'],
    [null, 'null overviewURL'],
    [42, 'numeric overviewURL'],
  ];

  for (const [badUrl, label] of invalidCases) {
    let fetchCalled = false;
    setFetch(async () => {
      fetchCalled = true;
      return mockResponse(200, {});
    });
    await expectReject(
      () => fetchInvestigationReport(API_BASE, badUrl),
      'bad overviewURL',
      `invalid overviewURL (${label}) → rejects with "bad overviewURL"`
    );
    check(!fetchCalled, `invalid overviewURL (${label}) → fetch NOT called`);
    restoreFetch();
  }

  // ── Happy path ─────────────────────────────────────────────────────────────

  console.log('\n--- fetchInvestigationReport: happy path ---');

  clearCache();
  const mockReport = {
    taskUuid: 'aaaabbbb-0000-0000-0000-000000000001',
    patient: { id: 'p-uuid-1' },
    status: 'pending',
  };
  let fetchCallCount = 0;
  setFetch(async () => {
    fetchCallCount++;
    return mockResponse(200, mockReport);
  });

  let result;
  try {
    result = await fetchInvestigationReport(API_BASE, VALID_URL);
    check(fetchCallCount === 1, 'happy path: fetch called exactly once');
    check(typeof result === 'object' && result !== null, 'happy path: returns an object');
    check(result.taskUuid === 'aaaabbbb-0000-0000-0000-000000000001', 'happy path: payload preserved (taskUuid)');
    check(result.patient && result.patient.id === 'p-uuid-1', 'happy path: payload preserved (patient.id)');
  } catch (e) {
    check(false, `happy path: unexpected rejection: ${e.message}`);
  }

  // ── Cache: second call must not fetch again ────────────────────────────────

  console.log('\n--- fetchInvestigationReport: cache dedup ---');

  try {
    const result2 = await fetchInvestigationReport(API_BASE, VALID_URL);
    check(fetchCallCount === 1, 'cache: second call served from cache (no extra fetch)');
    check(
      result2 === result || (result2 && result2.taskUuid === result.taskUuid),
      'cache: cached result matches original'
    );
  } catch (e) {
    check(false, `cache: unexpected rejection: ${e.message}`);
  }
  restoreFetch();

  // ── HTTP error propagates ─────────────────────────────────────────────────

  console.log('\n--- fetchInvestigationReport: HTTP error ---');

  clearCache();
  setFetch(async () => mockResponse(500, {}));
  await expectReject(
    () => fetchInvestigationReport(API_BASE, VALID_URL),
    'HTTP 500',
    'HTTP 500 → rejects with "HTTP 500"'
  );
  restoreFetch();
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await runMedicusApiTests();
    await runReferralsApiTests();
    await runActivityApiTests();
    await runUtilityTests();
    await runApiClientTests();
  } catch (e) {
    console.error('\nFATAL: test runner threw:', e);
    process.exitCode = 1;
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exitCode = 1;
})();
