// Medicus Suite — Referrals headless-discovery unit tests
// Run with: node test-referrals-discovery.js
//
// Covers the pure helpers and the I/O path of ensureReferralsDiscovery added
// to shared/referrals-api.js (REFERRALS-HEADLESS-DISCOVERY-PLAN.md).

'use strict';

(async () => {
  let passed = 0,
    failed = 0;
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

  const api = require('./shared/referrals-api.js');
  const { buildReferralsConfigUrl, buildReferralsTemplateUrl, isStaleTemplateError, ensureReferralsDiscovery } = api;

  // ── buildReferralsConfigUrl ──────────────────────────────────────────────────
  console.log('--- buildReferralsConfigUrl ---');

  const configUrl = buildReferralsConfigUrl('a3f2b1');
  check(
    typeof configUrl === 'string' &&
      configUrl === 'https://a3f2b1.api.england.medicus.health/referrals/data/outbound-nhs-referrals-audit',
    'returns correct config URL for valid code'
  );
  check(buildReferralsConfigUrl('XYZ!') === null, 'returns null for code with invalid chars');
  check(buildReferralsConfigUrl('') === null, 'returns null for empty string');
  check(buildReferralsConfigUrl(null) === null, 'returns null for null');
  check(buildReferralsConfigUrl('abc') === null, 'returns null for code shorter than 4 chars');

  // ── buildReferralsTemplateUrl ────────────────────────────────────────────────
  console.log('\n--- buildReferralsTemplateUrl ---');

  const PRIORITIES = ['two-week-wait', 'urgent', 'routine'];
  const STATUSES = ['incomplete', 'completed', 'cancelled'];

  const templateUrl = buildReferralsTemplateUrl('a3f2b1', {
    startDate: '2026-01-01',
    endDate: '2026-06-16',
    priorities: PRIORITIES,
    statuses: STATUSES,
    startRow: 0,
    endRow: 2000,
  });

  check(typeof templateUrl === 'string', 'returns a string for a valid code');
  check(
    templateUrl.includes('/referrals/data/clinical-audit-report/filter-outbound-nhs-referrals'),
    'contains the confirmed data path'
  );
  check(templateUrl.includes('startDate=2026-01-01'), 'contains startDate param');
  check(templateUrl.includes('endDate=2026-06-16'), 'contains endDate param');
  check(templateUrl.includes('startRow=0'), 'contains startRow param');
  check(templateUrl.includes('endRow=2000'), 'contains endRow param');

  // Repeated priorities[]
  const decodedTemplate = decodeURIComponent(templateUrl);
  check(
    decodedTemplate.includes('priorities[]=two-week-wait') &&
      decodedTemplate.includes('priorities[]=urgent') &&
      decodedTemplate.includes('priorities[]=routine'),
    'contains repeated priorities[] with lowercase-hyphenated values'
  );
  // Repeated statuses[]
  check(
    decodedTemplate.includes('statuses[]=incomplete') &&
      decodedTemplate.includes('statuses[]=completed') &&
      decodedTemplate.includes('statuses[]=cancelled'),
    'contains repeated statuses[] with lowercase values'
  );

  // Default startRow / endRow when omitted
  const templateDefault = buildReferralsTemplateUrl('a3f2b1', {
    startDate: '2026-01-01',
    endDate: '2026-06-16',
    priorities: [],
    statuses: [],
  });
  check(
    templateDefault && templateDefault.includes('startRow=0') && templateDefault.includes('endRow=2000'),
    'defaults startRow=0, endRow=2000 when not supplied'
  );

  check(buildReferralsTemplateUrl('XYZ!', {}) === null, 'returns null for invalid code');
  check(buildReferralsTemplateUrl('', {}) === null, 'returns null for empty code');

  // ── isStaleTemplateError ─────────────────────────────────────────────────────
  console.log('\n--- isStaleTemplateError ---');

  check(isStaleTemplateError({ status: 404 }) === true, 'true for err.status === 404');
  check(
    isStaleTemplateError(new Error('Got config response instead of referral data — check API URL')) === true,
    'true for the "Got config response instead of referral data" message'
  );
  check(isStaleTemplateError(new Error('HTTP 500 — server error')) === false, 'false for a generic 500 error message');
  check(
    isStaleTemplateError({ status: 403, message: 'Forbidden' }) === false,
    'false for 403 (auth issue, not stale URL)'
  );
  check(isStaleTemplateError(null) === false, 'false for null');

  // ── ensureReferralsDiscovery — mock helpers ──────────────────────────────────
  console.log('\n--- ensureReferralsDiscovery ---');

  // Minimal config payload that passes isConfigResponse (has Array priorityOptions).
  const MOCK_CONFIG_DATA = {
    priorityOptions: [
      { value: 'two-week-wait', label: 'Two Week Wait' },
      { value: 'urgent', label: 'Urgent' },
      { value: 'routine', label: 'Routine' },
    ],
    statusOptions: [
      { value: 'incomplete', label: 'Incomplete' },
      { value: 'completed', label: 'Completed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    defaultReferralStartDate: '2025-06-16',
    defaultReferralEndDate: '2026-06-16',
  };

  // Minimal data payload (has referrals array, no priorityOptions).
  const MOCK_DATA_PAYLOAD = { referrals: [], totalCount: 0 };

  // Build a mock fetchImpl that returns different payloads for the config vs data URL.
  function makeFetch(configBody, dataBody, opts) {
    opts = opts || {};
    return async function mockFetch(url, _fetchOpts) {
      const status = opts.status || 200;
      const isConfigUrl = url.includes('outbound-nhs-referrals-audit');
      const body = isConfigUrl ? configBody : dataBody;
      if (opts.throws) throw new Error(opts.throws);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    };
  }

  // Build a mock chrome.storage.local with a capture of set() calls.
  function makeStorage() {
    const store = {};
    const sets = [];
    return {
      store,
      sets,
      get(key, cb) {
        cb({ [key]: store[key] || null });
      },
      set(obj, cb) {
        sets.push({ ...obj });
        Object.assign(store, obj);
        if (cb) cb();
      },
    };
  }

  // ── Happy path: config validates + data validates ──────────────────────────
  {
    const storage = makeStorage();
    const fetchImpl = makeFetch(MOCK_CONFIG_DATA, MOCK_DATA_PAYLOAD);
    const result = await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });

    check(
      typeof result === 'string' && result.includes('filter-outbound-nhs-referrals'),
      'happy path: returns the data template URL'
    );

    const configSet = storage.sets.find((s) => s['referrals.config']);
    check(!!configSet, 'happy path: storage.set called for referrals.config');

    const discSet = storage.sets.find((s) => s['referrals.discovery']);
    check(!!discSet, 'happy path: storage.set called for referrals.discovery');

    // PHI guard: no persisted value should contain patient row fields.
    const allSetValues = JSON.stringify(storage.sets);
    check(
      !allSetValues.includes('"patient') &&
        !allSetValues.includes('"referralId') &&
        !allSetValues.includes('"patientGivenName') &&
        !allSetValues.includes('"referrals":'),
      'happy path: no patient/row PHI persisted in any storage.set call'
    );

    // Only url/discoveredAt are in referrals.discovery (no rows, no counts).
    const disc = discSet['referrals.discovery'];
    const discKeys = Object.keys(disc);
    check(
      discKeys.length === 2 && discKeys.includes('url') && discKeys.includes('discoveredAt'),
      'referrals.discovery contains only url + discoveredAt (no extra fields)'
    );

    // referrals.config.data must have only priorityOptions + statusOptions.
    const cfg = configSet['referrals.config'];
    const dataKeys = Object.keys(cfg.data);
    check(
      dataKeys.length === 2 && dataKeys.includes('priorityOptions') && dataKeys.includes('statusOptions'),
      'referrals.config.data contains only priorityOptions + statusOptions (no dates, no PHI)'
    );
  }

  // ── Config endpoint returns non-config blob → return null, no writes ────────
  {
    const storage = makeStorage();
    // Config endpoint returns something without priorityOptions.
    const fetchImpl = makeFetch({ someOtherField: true }, MOCK_DATA_PAYLOAD);
    const result = await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });

    check(result === null, 'non-config response from config endpoint → returns null');
    check(storage.sets.length === 0, 'non-config response → storage.set NOT called');
  }

  // ── Data endpoint returns a config blob → return null, no discovery write ───
  {
    const storage = makeStorage();
    // Config endpoint returns valid config; data endpoint returns another config blob.
    const fetchImpl = makeFetch(MOCK_CONFIG_DATA, MOCK_CONFIG_DATA);
    const result = await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });

    check(result === null, 'data endpoint returns config blob → returns null');
    const discSet = storage.sets.find((s) => s['referrals.discovery']);
    check(!discSet, 'data endpoint returns config blob → referrals.discovery NOT written');
  }

  // ── fetchImpl throws → returns null (fail-safe, no throw to caller) ─────────
  {
    const storage = makeStorage();
    const fetchImpl = makeFetch(null, null, { throws: 'Network error' });
    let threw = false;
    let result;
    try {
      result = await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });
    } catch (_) {
      threw = true;
    }
    check(!threw, 'fetchImpl throws → ensureReferralsDiscovery does NOT throw');
    check(result === null, 'fetchImpl throws → returns null');
  }

  // ── 401 / 403 response → returns null immediately, no write ─────────────────
  {
    const storage = makeStorage();
    const fetchImpl = makeFetch(null, null, { status: 401 });
    const result = await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });
    check(result === null, '401 from config endpoint → returns null');
    check(storage.sets.length === 0, '401 → no storage.set calls');
  }

  // ── Invalid practice code → returns null immediately ────────────────────────
  {
    const result = await ensureReferralsDiscovery('XYZ!', {
      fetchImpl: makeFetch(MOCK_CONFIG_DATA, MOCK_DATA_PAYLOAD),
      storage: makeStorage(),
    });
    check(result === null, 'invalid code → returns null without fetching');
  }

  // ── Idempotent: unchanged URL skips second write ─────────────────────────────
  {
    const storage = makeStorage();
    const fetchImpl = makeFetch(MOCK_CONFIG_DATA, MOCK_DATA_PAYLOAD);

    // First call — populates storage.
    await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });
    const setsAfterFirst = storage.sets.length;

    // Second call — URLs unchanged, should not re-write.
    await ensureReferralsDiscovery('a3f2b1', { fetchImpl, storage });
    check(
      storage.sets.length === setsAfterFirst,
      'second call with same URLs → no additional storage.set calls (idempotent)'
    );
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
