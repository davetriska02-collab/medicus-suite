// Medicus Suite — Extraction-health drift detection regression tests
// Run with: node test-extraction-baseline.js
//
// Tests the pure ExtractionHealth module (shared/extraction-health.js).
// No chrome APIs, no DOM. Validates algorithm correctness, boundary conditions,
// and the zero-PII schema guarantee (§6 of ws1-extraction-health.md).

'use strict';

const EH = require('./shared/extraction-health.js');

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkSample(m, o, p, d, t) {
  return { t: t || '2026-06-10T09:00:00.000Z', m, o, p, d };
}

// Seed a baseline with n copies of sample into the given bucket.
function seed(baseline, bucket, n, sample) {
  let b = baseline || null;
  for (let i = 0; i < n; i++) {
    const s = { ...sample, t: `2026-06-${String(10 + i).padStart(2, '0')}T09:00:00.000Z` };
    b = EH.updateBaseline(b, bucket, s);
  }
  return b;
}

const BUCKET_API = 'care-record-summary|api';
const BUCKET_DOM = 'care-record-summary|dom';
const HEALTHY = mkSample(12, 30, 4, 5);
const ZERO_MEDS = mkSample(0, 0, 0, 0);
const NOW = '2026-06-10T09:14:02.000Z';

// ── Module / API ──────────────────────────────────────────────────────────────
console.log('\n--- Module / API ---');
check(typeof EH === 'object' && EH !== null, 'module exports an object');
check(typeof EH.summariseExtraction === 'function', 'summariseExtraction exported');
check(typeof EH.updateBaseline === 'function', 'updateBaseline exported');
check(typeof EH.assessDrift === 'function', 'assessDrift exported');
check(typeof EH.shouldRecordSample === 'function', 'shouldRecordSample exported');
check(typeof EH.isMuted === 'function', 'isMuted exported');
check(typeof EH.muteBaseline === 'function', 'muteBaseline exported');
check(typeof EH.markWarned === 'function', 'markWarned exported');
check(typeof EH.constants === 'object' && EH.constants !== null, 'constants object exported');

check(EH.constants.MAX_SAMPLES === 40, 'MAX_SAMPLES === 40');
check(EH.constants.RECENT_N === 5, 'RECENT_N === 5');
check(EH.constants.MIN_HISTORY === 10, 'MIN_HISTORY === 10');
check(EH.constants.MIN_MEANINGFUL_MEDIAN === 3, 'MIN_MEANINGFUL_MEDIAN === 3');
check(EH.constants.RECENT_ZERO_RATE === 0.8, 'RECENT_ZERO_RATE === 0.8');
check(EH.constants.MUTE_HOURS === 24, 'MUTE_HOURS === 24');
check(EH.constants.SAMPLE_MIN_GAP_MS === 15 * 60 * 1000, 'SAMPLE_MIN_GAP_MS === 15 min');

// updateBaseline(null, ...) initialises a {v:1} baseline
const initB = EH.updateBaseline(null, BUCKET_API, mkSample(5, 10, 2, 5));
check(initB && initB.v === 1, 'updateBaseline(null,...) initialises v:1');
check(initB.buckets && typeof initB.buckets === 'object', 'buckets object created');
check(initB.mutedUntil === null, 'mutedUntil null on init');
check(initB.lastWarnAt === null, 'lastWarnAt null on init');
check(Array.isArray(initB.buckets[BUCKET_API].samples), 'bucket samples array created');
check(initB.buckets[BUCKET_API].samples.length === 1, 'first sample stored');

// ── summariseExtraction ───────────────────────────────────────────────────────
console.log('\n--- summariseExtraction ---');

// Returns null for mock mode
check(
  EH.summariseExtraction(
    { mode: 'mock', patientContext: { patientName: 'Smith', view: 'care-record-summary' } },
    NOW
  ) === null,
  'returns null for mock mode'
);

// Returns null when no patient identity
check(
  EH.summariseExtraction(
    { mode: 'live', patientContext: { view: 'care-record-summary' }, debug: { dataSource: 'api' } },
    NOW
  ) === null,
  'returns null when no patient identity'
);

// Returns null when view is 'unknown'
check(
  EH.summariseExtraction(
    { mode: 'live', patientContext: { patientName: 'Smith', view: 'unknown' }, debug: { dataSource: 'api' } },
    NOW
  ) === null,
  "returns null when view is 'unknown'"
);

// Returns null when view is absent
check(
  EH.summariseExtraction(
    { mode: 'live', patientContext: { patientName: 'Smith' }, debug: { dataSource: 'api' } },
    NOW
  ) === null,
  'returns null when view is absent'
);

// Bucket key: api path
const apiResult = EH.summariseExtraction(
  {
    mode: 'live',
    patientContext: { patientName: 'Smith', view: 'care-record-summary' },
    debug: { dataSource: 'api (via url)' },
    medications: [{ name: 'x' }, { name: 'y' }],
    observations: [{ name: 'o' }],
    problems: [],
  },
  NOW
);
check(apiResult !== null, 'returns result for valid live+patient+view+api');
check(apiResult.bucket === 'care-record-summary|api', "bucket ends with '|api' for api dataSource");
check(apiResult.sample.m === 2, 'sample.m counts medications');
check(apiResult.sample.o === 1, 'sample.o counts observations');
check(apiResult.sample.p === 0, 'sample.p counts problems');

// Bucket key: dom-fallback path
const domResult = EH.summariseExtraction(
  {
    mode: 'live',
    patientContext: { patientId: 'abc', view: 'prescription-request' },
    debug: { dataSource: 'dom-fallback (section)' },
    medications: [],
    observations: [],
    problems: [],
  },
  NOW
);
check(domResult !== null, 'returns result for dom-fallback dataSource');
check(domResult.bucket === 'prescription-request|dom', "bucket ends with '|dom' for dom-fallback");

// Demographic field counting: 0–5
const demoFull = EH.summariseExtraction(
  {
    mode: 'live',
    patientContext: {
      patientUuid: 'abc',
      view: 'care-record-summary',
      dob: '1980-01-01',
      dobRaw: '01/01/1980',
      ageYears: 46,
      sex: 'male',
      nhsNumber: '1234567890',
    },
    debug: { dataSource: 'api' },
    medications: [],
    observations: [],
    problems: [],
  },
  NOW
);
check(demoFull && demoFull.sample.d === 5, 'all 5 demographic fields → d=5');

const demoNone = EH.summariseExtraction(
  {
    mode: 'live',
    patientContext: { patientName: 'Smith', view: 'care-record-summary' },
    debug: { dataSource: 'api' },
    medications: [],
    observations: [],
    problems: [],
  },
  NOW
);
check(demoNone && demoNone.sample.d === 0, 'no demographic fields → d=0');

// ageYears: 0 is not null — counts as present
const demoAge0 = EH.summariseExtraction(
  {
    mode: 'live',
    patientContext: { patientName: 'Smith', view: 'care-record-summary', ageYears: 0 },
    debug: { dataSource: 'api' },
    medications: [],
    observations: [],
    problems: [],
  },
  NOW
);
check(demoAge0 && demoAge0.sample.d === 1, 'ageYears=0 (non-null) counts as present → d=1');

// ── Cold start ────────────────────────────────────────────────────────────────
console.log('\n--- Cold start ---');
// MIN_HISTORY=10, RECENT_N=5. Need at least 15 total (10 history + 5 recent).
// Seeding 9 healthy + 5 zero candidate = 14 total → still cold start.
{
  const b9 = seed(null, BUCKET_API, 9, HEALTHY);
  const cand = ZERO_MEDS;
  // Insert 4 more zero samples to fill the recent window (but all=14, history=9 < MIN_HISTORY)
  let b14 = b9;
  for (let i = 0; i < 4; i++) b14 = EH.updateBaseline(b14, BUCKET_API, ZERO_MEDS);
  const drift = EH.assessDrift(b14, BUCKET_API, cand);
  check(drift.drifted === false, 'cold start: 9 history + 5 recent (14 total) → no drift');
}

// Exactly at boundary: 10 history + 5 recent candidate = 15 total → drift CAN fire.
{
  const b10 = seed(null, BUCKET_API, 10, HEALTHY);
  // Add 4 zeros to storage (recent window), then pass zero as candidate (5th recent)
  let b = b10;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_API, ZERO_MEDS);
  const drift = EH.assessDrift(b, BUCKET_API, ZERO_MEDS);
  check(drift.drifted === true, 'boundary: 10 history + 5 recent zeros → drift fires');
}

// ── Drift fires ───────────────────────────────────────────────────────────────
console.log('\n--- Drift fires ---');
{
  const b20 = seed(null, BUCKET_API, 20, HEALTHY);
  // 4 zeros in storage + zero candidate = 5 recent zeros
  let b = b20;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_API, ZERO_MEDS);
  const drift = EH.assessDrift(b, BUCKET_API, ZERO_MEDS);
  check(drift.drifted === true, 'drift fires: 20 healthy history + 5 recent zeros');
  check(Array.isArray(drift.metrics) && drift.metrics.length > 0, 'drift.metrics is non-empty');
  const medMetric = drift.metrics.find((x) => x.name === 'medications');
  check(!!medMetric, 'medications metric in drift.metrics');
  check(typeof drift.reason === 'string' && drift.reason.length > 0, 'drift.reason is a non-empty string');
  check(drift.reason.includes('12') || drift.reason.includes('~'), 'reason mentions typical count');
  check(drift.bucket === BUCKET_API, 'drift.bucket is set');
}

// ── False-positive guards ─────────────────────────────────────────────────────
console.log('\n--- False-positive guards ---');

// One sparse record after healthy history → false
{
  const b20 = seed(null, BUCKET_API, 20, HEALTHY);
  // Only 1 zero in recent window (the candidate); other 4 recent are healthy
  let b = b20;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_API, HEALTHY);
  const drift = EH.assessDrift(b, BUCKET_API, ZERO_MEDS);
  check(drift.drifted === false, 'one sparse record in recent window → no drift (zeroRate 0.2)');
}

// Alternating sparse/healthy recent window (zeroRate 0.6) → false
{
  const b20 = seed(null, BUCKET_API, 20, HEALTHY);
  let b = b20;
  // 2 zeros + 2 healthy in storage, zero candidate → 3 zeros, zeroRate = 0.6
  b = EH.updateBaseline(b, BUCKET_API, ZERO_MEDS);
  b = EH.updateBaseline(b, BUCKET_API, HEALTHY);
  b = EH.updateBaseline(b, BUCKET_API, ZERO_MEDS);
  b = EH.updateBaseline(b, BUCKET_API, HEALTHY);
  const drift = EH.assessDrift(b, BUCKET_API, ZERO_MEDS);
  check(drift.drifted === false, 'alternating recent window (zeroRate 0.6) → no drift');
}

// History median for problems < MIN_MEANINGFUL_MEDIAN (e.g. 1) → no drift for that metric
{
  const sparseProblem = mkSample(12, 30, 1, 5); // problems historically ~1
  const b20 = seed(null, BUCKET_API, 20, sparseProblem);
  let b = b20;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_API, mkSample(0, 0, 0, 0));
  const drift = EH.assessDrift(b, BUCKET_API, mkSample(0, 0, 0, 0));
  // Should still drift on m=12 and o=30, but NOT on p (median 1 < MIN_MEANINGFUL_MEDIAN=3)
  if (drift.drifted) {
    const probMetric = drift.metrics.find((x) => x.name === 'problems');
    check(!probMetric, 'problems metric excluded when histMedian < MIN_MEANINGFUL_MEDIAN');
  } else {
    check(false, 'drift should have fired for medications/observations (histMedian >= 3)');
  }
}

// Per-bucket isolation: zeros in dom bucket don't alarm api bucket
{
  const bApi = seed(null, BUCKET_API, 20, HEALTHY);
  // Put zeros only in the dom bucket
  let b = bApi;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_DOM, ZERO_MEDS);
  const driftApi = EH.assessDrift(b, BUCKET_API, ZERO_MEDS);
  // api bucket only has 20 healthy in storage, candidate is the first zero → zeroRate 0.2
  check(driftApi.drifted === false, 'per-bucket isolation: zeros in dom bucket do not alarm api bucket');
}

// ── Demographics drift ────────────────────────────────────────────────────────
console.log('\n--- Demographics drift ---');
{
  const fullDemo = mkSample(12, 30, 4, 5);
  const noDemo = mkSample(0, 0, 0, 0); // all zeros including d
  const b20 = seed(null, BUCKET_API, 20, fullDemo);
  let b = b20;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_API, noDemo);
  const drift = EH.assessDrift(b, BUCKET_API, noDemo);
  check(drift.drifted === true, 'demographics drift fires when d historically 5, recently all 0');
  const demoMetric = drift.metrics && drift.metrics.find((x) => x.name === 'demographics');
  check(!!demoMetric, 'demographics metric present in drift.metrics');
}

// Demographics drift with healthy med counts (isolated demo failure)
{
  const fullDemo = mkSample(12, 30, 4, 5);
  const demoGone = mkSample(12, 30, 4, 0); // meds/obs/problems healthy, demographics gone
  const b20 = seed(null, BUCKET_API, 20, fullDemo);
  let b = b20;
  for (let i = 0; i < 4; i++) b = EH.updateBaseline(b, BUCKET_API, demoGone);
  const drift = EH.assessDrift(b, BUCKET_API, demoGone);
  check(drift.drifted === true, 'demographics drift fires even with healthy med/obs/problem counts');
  const demoMetric = drift.metrics && drift.metrics.find((x) => x.name === 'demographics');
  check(!!demoMetric, 'demographics in metrics for isolated demographic failure');
  const medMetric = drift.metrics && drift.metrics.find((x) => x.name === 'medications');
  check(!medMetric, 'medications NOT in metrics when meds counts remain healthy');
}

// ── Window management ─────────────────────────────────────────────────────────
console.log('\n--- Window management ---');
{
  let b = null;
  for (let i = 0; i < 60; i++) {
    b = EH.updateBaseline(b, BUCKET_API, mkSample(1, 2, 3, 4, `2026-06-10T0${String(i).padStart(1, '0')}:00:00.000Z`));
  }
  const samples = b.buckets[BUCKET_API].samples;
  check(samples.length === 40, `after 60 updates samples.length === MAX_SAMPLES (got ${samples.length})`);
  // Oldest should be entry ~20 (0-indexed), not entry 0
  check(samples[0].t !== '2026-06-10T00:00:00.000Z', 'oldest entry was trimmed (not the very first)');
}

// updateBaseline does not mutate its input (deep-freeze test)
{
  let b = seed(null, BUCKET_API, 5, HEALTHY);
  const frozen = JSON.parse(JSON.stringify(b));
  Object.freeze(frozen);
  Object.freeze(frozen.buckets);
  Object.freeze(frozen.buckets[BUCKET_API]);
  Object.freeze(frozen.buckets[BUCKET_API].samples);
  let threw = false;
  try {
    const result = EH.updateBaseline(frozen, BUCKET_API, HEALTHY);
    // result should be a NEW object, not the frozen one
    check(result !== frozen, 'updateBaseline returns a new object (not the frozen input)');
  } catch (_) {
    threw = true;
  }
  check(!threw, 'updateBaseline does not throw when input is frozen (pure/no-mutate)');
}

// ── Mute / debounce ───────────────────────────────────────────────────────────
console.log('\n--- Mute / debounce ---');

// isMuted: false on null baseline
check(EH.isMuted(null, NOW) === false, 'isMuted(null, ...) → false');
check(
  EH.isMuted({ v: 1, buckets: {}, mutedUntil: null, lastWarnAt: null }, NOW) === false,
  'isMuted with mutedUntil:null → false'
);

// muteBaseline: adds exactly MUTE_HOURS
{
  const t0 = '2026-06-10T09:00:00.000Z';
  const muted = EH.muteBaseline(null, t0);
  check(
    muted.mutedUntil === '2026-06-11T09:00:00.000Z',
    `muteBaseline adds ${EH.constants.MUTE_HOURS}h (got ${muted.mutedUntil})`
  );
}

// isMuted: true while muted, false after expiry
{
  const t0 = '2026-06-10T09:00:00.000Z';
  const muted = EH.muteBaseline(null, t0);
  check(EH.isMuted(muted, '2026-06-10T20:00:00.000Z') === true, 'isMuted true before expiry');
  check(EH.isMuted(muted, '2026-06-11T10:00:00.000Z') === false, 'isMuted false after expiry');
}

// muteBaseline does not mutate its input
{
  const b = { v: 1, buckets: {}, mutedUntil: null, lastWarnAt: null };
  const frozen = Object.freeze({ ...b });
  let threw = false;
  try {
    EH.muteBaseline(frozen, NOW);
  } catch (_) {
    threw = true;
  }
  check(!threw, 'muteBaseline does not throw when input is frozen');
}

// shouldRecordSample: false for same key within 15 min
{
  const key = 'patient-abc|care-record-summary|api';
  const t0 = Date.now();
  check(
    EH.shouldRecordSample(key, t0, key, t0 + 5 * 60 * 1000) === false,
    'shouldRecordSample false for same key within 15 min'
  );
  check(
    EH.shouldRecordSample(key, t0, key, t0 + 16 * 60 * 1000) === true,
    'shouldRecordSample true after gap >= 15 min'
  );
  check(EH.shouldRecordSample(key, t0, 'different-key', t0 + 1000) === true, 'shouldRecordSample true on key change');
  check(EH.shouldRecordSample(null, 0, key, t0) === true, 'shouldRecordSample true when lastSampleKey is null');
}

// markWarned: sets lastWarnAt if null
{
  const b0 = { v: 1, buckets: {}, mutedUntil: null, lastWarnAt: null };
  const b1 = EH.markWarned(b0, NOW);
  check(b1.lastWarnAt === NOW, 'markWarned sets lastWarnAt when null');
}

// markWarned: does NOT update if warned < 4h ago
{
  const warnedAt = '2026-06-10T09:00:00.000Z';
  const b0 = { v: 1, buckets: {}, mutedUntil: null, lastWarnAt: warnedAt };
  const twoHoursLater = '2026-06-10T11:00:00.000Z';
  const b1 = EH.markWarned(b0, twoHoursLater);
  check(b1.lastWarnAt === warnedAt, 'markWarned does not update lastWarnAt if < 4h since last warn');
}

// markWarned: DOES update if warned > 4h ago
{
  const warnedAt = '2026-06-10T09:00:00.000Z';
  const b0 = { v: 1, buckets: {}, mutedUntil: null, lastWarnAt: warnedAt };
  const fiveHoursLater = '2026-06-10T14:00:00.000Z';
  const b1 = EH.markWarned(b0, fiveHoursLater);
  check(b1.lastWarnAt === fiveHoursLater, 'markWarned updates lastWarnAt if > 4h since last warn');
}

// markWarned does not mutate input
{
  const b0 = { v: 1, buckets: {}, mutedUntil: null, lastWarnAt: null };
  const frozen = Object.freeze({ ...b0 });
  let threw = false;
  try {
    EH.markWarned(frozen, NOW);
  } catch (_) {
    threw = true;
  }
  check(!threw, 'markWarned does not throw when input is frozen');
}

// ── Zero-PII schema guard ─────────────────────────────────────────────────────
console.log('\n--- Zero-PII schema guard ---');
{
  // Build a realistic baseline with multiple buckets and varied data.
  let b = null;
  const buckets = ['care-record-summary|api', 'prescription-request|api', 'consultation-edit|dom'];
  const samples = [mkSample(12, 34, 5, 5), mkSample(0, 0, 0, 0), mkSample(8, 20, 3, 4), mkSample(5, 10, 2, 3)];
  for (const bucket of buckets) {
    for (let i = 0; i < 12; i++) {
      b = EH.updateBaseline(b, bucket, {
        ...samples[i % samples.length],
        t: `2026-06-${String(10 + i).padStart(2, '0')}T09:00:00.000Z`,
      });
    }
  }

  const serialised = JSON.stringify(b);

  // Every sample must only have keys: t, m, o, p, d
  const ALLOWED_SAMPLE_KEYS = new Set(['t', 'm', 'o', 'p', 'd']);
  let allSamplesClean = true;
  for (const [bucketKey, entry] of Object.entries(b.buckets)) {
    for (const s of entry.samples) {
      const keys = Object.keys(s);
      for (const k of keys) {
        if (!ALLOWED_SAMPLE_KEYS.has(k)) {
          allSamplesClean = false;
          console.error(`    Unexpected key in sample: ${k} (bucket: ${bucketKey})`);
        }
      }
      // t must be an ISO timestamp
      check(
        typeof s.t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s.t),
        `sample.t is ISO-shaped: ${s.t}`
      );
      // m, o, p, d must be finite non-negative integers
      for (const f of ['m', 'o', 'p', 'd']) {
        check(
          Number.isFinite(s[f]) && s[f] >= 0 && Number.isInteger(s[f]),
          `sample.${f} is finite non-negative integer (got ${s[f]})`
        );
      }
    }
  }
  check(allSamplesClean, 'all sample objects contain only allowed keys (t, m, o, p, d)');

  // No 10-digit run in the serialised baseline (NHS number shape)
  check(!/\d{10}/.test(serialised), 'serialised baseline contains no 10-digit run (NHS number shape)');

  // No UUID-shaped substring (8-4-4-4-12 hex)
  check(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialised),
    'serialised baseline contains no UUID-shaped substring'
  );
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
