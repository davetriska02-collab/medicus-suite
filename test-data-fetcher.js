// Medicus Suite — Data Fetcher orchestration tests
// Run with: node test-data-fetcher.js
//
// engine/data-fetcher.js is the API-first orchestration layer: it resolves a
// patient UUID (URL → encounter → task → DOM banner), fetches the four Medicus
// endpoints, normalises, and falls back to DOM extraction on every failure
// path. None of that branching was directly covered before (only exercised
// incidentally by the E2E pipeline). This pins the orchestration contract:
// which resolution source wins, and that EVERY failure degrades to a
// dom-fallback result rather than throwing into the content script.
//
// The module reads its collaborators off the global object at call time
// (global.SentinelApiClient / SentinelNormalisers / extractors), so we stub
// them per-scenario. document/location are stubbed minimally so the DOM
// fallback path can run in Node.

'use strict';

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

// Minimal browser-ish globals so fetchFromDom() can execute in Node. Extractor
// globals are intentionally left undefined → fetchFromDom yields empty arrays.
global.document = { title: 'stub', querySelectorAll: () => [] };
global.location = { href: 'https://x.medicus.health/patient/123' };
global.performance = { getEntriesByType: () => [] };

const fetcher = require(path.join(__dirname, 'engine', 'data-fetcher.js'));

function clearCollaborators() {
  delete global.SentinelApiClient;
  delete global.SentinelNormalisers;
  delete global.SentinelPatientContext;
  delete global.SentinelMedications;
  delete global.SentinelObservations;
  delete global.SentinelProblems;
}

// ── fetchMock: stable demo shape ───────────────────────────────────────────
console.log('\n--- fetchMock ---');
{
  const m = fetcher.fetchMock();
  check(m.mode === 'mock', 'fetchMock mode is mock');
  check(Array.isArray(m.medications) && m.medications.length > 0, 'fetchMock has medications');
  check(Array.isArray(m.observations) && m.observations.length > 0, 'fetchMock has observations');
  check(m.patientContext && m.patientContext.nhsNumber, 'fetchMock has a patient context');
  check(m.debug && m.debug.dataSource === 'mock', 'fetchMock debug.dataSource is mock');
}

// ── fetchPatientData routes by mode ────────────────────────────────────────
console.log('\n--- fetchPatientData routing ---');
(async () => {
  const r = await fetcher.fetchPatientData('mock');
  check(r.mode === 'mock', "fetchPatientData('mock') resolves the mock");
})();

// ── fetchLive: no Medicus context → DOM fallback ───────────────────────────
console.log('\n--- fetchLive: no medicus context ---');
(async () => {
  clearCollaborators();
  global.SentinelApiClient = { detectMedicusContext: () => null };
  global.SentinelNormalisers = { normaliseAll: () => ({}) };
  const r = await fetcher.fetchLive();
  check(/dom-fallback \(no medicus context\)/.test(r.debug.dataSource), 'no-context → dom-fallback labelled');
  check(
    Array.isArray(r.medications) && r.medications.length === 0,
    'no-context fallback yields empty meds (no extractors)'
  );
})();

// ── fetchLive: happy path (URL-resolved patient) ───────────────────────────
console.log('\n--- fetchLive: API happy path ---');
(async () => {
  clearCollaborators();
  global.SentinelApiClient = {
    detectMedicusContext: () => ({ apiBase: 'https://api', patientUuid: 'p-1' }),
    fetchAll: async () => ({ banner: { name: 'X' }, errors: {} }),
  };
  global.SentinelNormalisers = {
    normaliseAll: () => ({
      patientContext: { patientName: 'X' },
      medications: [{ name: 'Methotrexate' }],
      observations: [{ name: 'FBC' }],
      observationHistory: [],
      problems: [],
    }),
  };
  global.SentinelPatientContext = { detectView: () => 'patient' };
  const r = await fetcher.fetchLive();
  check(r.mode === 'live', 'happy path mode is live');
  check(r.medications.length === 1 && r.observations.length === 1, 'happy path returns normalised data');
  check(/^api \(via url\)/.test(r.debug.dataSource), 'happy path resolutionSource is url');
  check(r.debug.resolutionSource === 'url', 'happy path debug.resolutionSource = url');
})();

// ── fetchLive: encounter → patient resolution ──────────────────────────────
console.log('\n--- fetchLive: encounter resolution ---');
(async () => {
  clearCollaborators();
  let resolveCalled = false;
  global.SentinelApiClient = {
    detectMedicusContext: () => ({ apiBase: 'https://api', encounterUuid: 'e-9' }),
    resolveEncounterToPatient: async () => {
      resolveCalled = true;
      return 'p-9';
    },
    fetchAll: async () => ({ banner: { name: 'Y' }, errors: {} }),
  };
  global.SentinelNormalisers = {
    normaliseAll: () => ({
      patientContext: {},
      medications: [],
      observations: [],
      observationHistory: [],
      problems: [],
    }),
  };
  const r = await fetcher.fetchLive();
  check(resolveCalled, 'encounter→patient resolver was called');
  check(r.debug.resolutionSource === 'encounter-resolver', 'resolutionSource = encounter-resolver');
})();

// ── fetchLive: API returns no banner → DOM fallback ────────────────────────
console.log('\n--- fetchLive: api failed (no banner) → dom fallback ---');
(async () => {
  clearCollaborators();
  global.SentinelApiClient = {
    detectMedicusContext: () => ({ apiBase: 'https://api', patientUuid: 'p-2' }),
    fetchAll: async () => ({ banner: null, errors: { observations: '500' } }),
  };
  global.SentinelNormalisers = { normaliseAll: () => ({}) };
  const r = await fetcher.fetchLive();
  check(/dom-fallback \(api failed/.test(r.debug.dataSource), 'no-banner → dom-fallback (api failed) labelled');
})();

// ── fetchLive: fetchAll throws → DOM fallback (never propagates) ───────────
console.log('\n--- fetchLive: api exception → dom fallback ---');
(async () => {
  clearCollaborators();
  global.SentinelApiClient = {
    detectMedicusContext: () => ({ apiBase: 'https://api', patientUuid: 'p-3' }),
    fetchAll: async () => {
      throw new Error('boom');
    },
  };
  global.SentinelNormalisers = { normaliseAll: () => ({}) };
  let threw = false;
  let r;
  try {
    r = await fetcher.fetchLive();
  } catch (e) {
    threw = true;
  }
  check(!threw, 'fetchLive never propagates an API exception to the caller');
  check(
    r && /dom-fallback \(api exception: boom\)/.test(r.debug.dataSource),
    'api exception → dom-fallback (api exception) labelled'
  );
})();

// Defer the summary until the async scenarios above have settled.
setTimeout(() => {
  console.log(`\nData-fetcher: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}, 50);
