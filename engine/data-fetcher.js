// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Data Fetcher (v0.3)
//
// API-first: hits the four Medicus REST endpoints when on a Medicus page.
// Falls back to DOM extraction if API unavailable or off-Medicus.
//
// Modes:
//   live      — API first, DOM fallback
//   mock      — demo data for UI testing
//   discovery — logs page structure and API calls observed

(function(global) {
  'use strict';

  // === MOCK ===
  const MOCK_PATIENT = {
    patientContext: {
      patientName: 'Mock Patient',
      nhsNumber: '9876543210',
      dob: '1958-04-26',
      dobRaw: '26 Apr 1958',
      ageYears: 68,
      sex: 'male',
      url: 'about:mock',
      title: 'Mock',
      view: 'mock'
    },
    medications: [
      { name: 'Methotrexate 10mg tablets', startDate: '2022-03-15', source: 'mock' },
      { name: 'Lithium carbonate 400mg modified release tablets', startDate: '2019-11-02', source: 'mock' },
      { name: 'Ramipril 5mg capsules', startDate: '2024-06-01', source: 'mock' },
      { name: 'Atorvastatin 40mg tablets', startDate: '2023-01-10', source: 'mock' },
      { name: 'Levothyroxine 100mcg tablets', startDate: '2018-05-20', source: 'mock' }
    ],
    observations: [
      { name: 'U&E', code: '275773008', date: '2025-12-01', value: 'normal', source: 'mock' },
      { name: 'FBC', code: '26604007', date: '2025-12-01', value: 'normal', source: 'mock' },
      { name: 'LFT', code: '26958001', date: '2025-12-01', value: 'normal', source: 'mock' },
      { name: 'TSH', code: '61167004', date: '2025-09-15', value: '2.1', source: 'mock' },
      { name: 'Blood pressure', code: '75367002', date: '2026-04-27', value: '146/82 mmHg', source: 'mock' },
      { name: 'HbA1c', code: '43396009', date: '2026-02-01', value: '65 mmol/mol', source: 'mock' }
    ],
    observationHistory: [
      { name: 'Blood pressure', code: null, group: 'Key observations', unit: 'mmHg', history: [
        { date: '2026-04-27', value: NaN, rawValue: '146/82', isAbove: false, isBelow: false, source: 'mock' },
        { date: '2025-10-14', value: NaN, rawValue: '152/88', isAbove: true,  isBelow: false, source: 'mock' },
        { date: '2025-04-03', value: NaN, rawValue: '148/90', isAbove: true,  isBelow: false, source: 'mock' },
        { date: '2024-10-21', value: NaN, rawValue: '155/92', isAbove: true,  isBelow: false, source: 'mock' },
        { date: '2024-04-09', value: NaN, rawValue: '162/94', isAbove: true,  isBelow: false, source: 'mock' }
      ]},
      { name: 'HbA1c', code: '43396009', group: 'HbA1c', unit: 'mmol/mol', history: [
        { date: '2026-02-01', value: 65, rawValue: '65', isAbove: true,  isBelow: false, source: 'mock' },
        { date: '2025-08-15', value: 62, rawValue: '62', isAbove: true,  isBelow: false, source: 'mock' },
        { date: '2025-02-10', value: 58, rawValue: '58', isAbove: false, isBelow: false, source: 'mock' },
        { date: '2024-08-05', value: 55, rawValue: '55', isAbove: false, isBelow: false, source: 'mock' }
      ]}
    ],
    problems: [
      { label: 'Type 2 diabetes mellitus', codedDate: '2019-06-12', status: 'active', source: 'mock' },
      { label: 'Essential hypertension', codedDate: '2018-03-04', status: 'active', source: 'mock' }
    ]
  };

  function fetchMock() {
    return {
      mode: 'mock',
      ...MOCK_PATIENT,
      debug: { foundHeadings: [], parseFailures: [], dataSource: 'mock' }
    };
  }

  // === DISCOVERY ===
  function runDiscovery() {
    const findings = {
      mode: 'discovery',
      url: location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      headings: [],
      apiContext: null,
      definitionLists: [],
      apiCallsObserved: []
    };
    // Detect Medicus context
    const API = global.SentinelApiClient;
    if (API) findings.apiContext = API.detectMedicusContext(location.href);
    // List headings
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      findings.headings.push({
        tag: h.tagName,
        text: (h.textContent || '').trim().slice(0, 80),
        classes: (h.className || '').slice(0, 60)
      });
    });
    // Observed API calls
    findings.apiCallsObserved = performance.getEntriesByType('resource')
      .filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
      .map(e => e.name)
      .filter(u => /\/data\//.test(u))
      .slice(0, 30);
    document.querySelectorAll('dl').forEach(dl => {
      findings.definitionLists.push({
        classes: (dl.className || '').slice(0, 60),
        childCount: dl.children.length
      });
    });
    return findings;
  }

  // === DOM FALLBACK ===
  function fetchFromDom() {
    const doc = document;
    const now = new Date();
    const PC = global.SentinelPatientContext;
    const M = global.SentinelMedications;
    const O = global.SentinelObservations;
    const P = global.SentinelProblems;
    const patientContext = PC ? PC.extract(doc, now.toISOString()) : null;
    // The DOM patient-context extractor doesn't emit a patient UUID. Resolve one
    // (URL path, then a single-patient DOM banner scan) and attach it so the
    // side-panel same-patient nav guard (_lastPatientUuid) can recognise
    // sub-navigation on DOM-fallback views instead of invalidating + re-fetching
    // on every URL change.
    if (patientContext && !patientContext.patientUuid) {
      const API = global.SentinelApiClient;
      if (API) {
        const uuid = (API.detectMedicusContext && API.detectMedicusContext(location.href)?.patientUuid)
          || (API.findPatientUuidFromDom && API.findPatientUuidFromDom(doc))
          || null;
        if (uuid) patientContext.patientUuid = uuid;
      }
    }
    const medsResult = M ? M.extract(doc) : { medications: [] };
    const obsResult = O ? O.extract(doc) : { observations: [], parseFailures: [] };
    const probResult = P ? P.extract(doc) : { problems: [] };
    return {
      mode: 'live',
      patientContext,
      medications: medsResult.medications,
      observations: obsResult.observations,
      // DOM fallback has no structured history — evaluators treat empty array as no_data
      observationHistory: [],
      problems: probResult.problems,
      debug: {
        foundHeadings: [],
        parseFailures: obsResult.parseFailures || [],
        dataSource: 'dom-fallback'
      }
    };
  }

  // === LIVE (API-first) ===
  async function fetchLive() {
    const API = global.SentinelApiClient;
    const NORM = global.SentinelNormalisers;
    if (!API || !NORM) return fetchFromDom();
    const ctx = API.detectMedicusContext(location.href);
    if (!ctx) {
      const dom = fetchFromDom();
      dom.debug.dataSource = 'dom-fallback (no medicus context)';
      return dom;
    }
    // If we have an encounter UUID but no patient UUID, resolve it.
    let patientUuid = ctx.patientUuid;
    let resolutionSource = 'url';
    let resolvedFromEncounter = false;
    let resolvedFromTask = false;
    let resolvedFromDom = false;
    if (!patientUuid && ctx.encounterUuid) {
      try {
        patientUuid = await API.resolveEncounterToPatient(ctx.apiBase, ctx.encounterUuid);
        resolvedFromEncounter = !!patientUuid;
        if (resolvedFromEncounter) resolutionSource = 'encounter-resolver';
      } catch (e) {
        // fall through
      }
    }
    // Task overview URL: resolve via /tasks/data/{slug}/overview/{taskUuid} endpoint.
    // Covers prescription requests, medical requests, investigation results review,
    // general task overview, and similar single-patient task views.
    if (!patientUuid && ctx.taskUuid) {
      try {
        patientUuid = await API.resolveTaskToPatient(ctx.apiBase, ctx.taskTypeSlug, ctx.taskUuid);
        resolvedFromTask = !!patientUuid;
        if (resolvedFromTask) resolutionSource = `task-resolver:${ctx.taskTypeSlug}`;
      } catch (e) {
        // fall through
      }
    }
    // Final universal fallback: scan the live DOM for a single patient UUID.
    if (!patientUuid) {
      const fromDom = API.findPatientUuidFromDom(document);
      if (fromDom) {
        patientUuid = fromDom;
        resolvedFromDom = true;
        resolutionSource = 'dom-banner';
      }
    }
    if (!patientUuid) {
      const dom = fetchFromDom();
      let reason = 'no patient uuid in url or banner';
      if (ctx.encounterUuid) reason = 'encounter -> patient resolution failed';
      else if (ctx.taskUuid) reason = `task -> patient resolution failed (${ctx.taskTypeSlug})`;
      dom.debug.dataSource = `dom-fallback (${reason})`;
      return dom;
    }
    try {
      const apiResults = await API.fetchAll(ctx.apiBase, patientUuid);
      const errorCount = Object.keys(apiResults.errors || {}).length;
      if (!apiResults.banner) {
        const dom = fetchFromDom();
        dom.debug.dataSource = `dom-fallback (api failed: ${Object.values(apiResults.errors).join(', ')})`;
        return dom;
      }
      const urlContext = {
        url: location.href,
        title: document.title,
        view: global.SentinelPatientContext?.detectView(location.href) || null,
        patientUuid,
        encounterUuid: ctx.encounterUuid || null,
        resolutionSource
      };
      const normalised = NORM.normaliseAll(apiResults, urlContext);
      const apiLabel = `api (via ${resolutionSource})`;
      // Per-field DOM fallback: banner succeeded (checked above), but one or more
      // of the other three endpoints can still have failed individually while
      // fetchAll() didn't throw. Left unhandled, a failed medicationRegimen /
      // problemListing / investigationDashboard normalises to an empty array —
      // indistinguishable downstream (content.js computeMonitoringChip) from
      // "patient genuinely has no medications", so a drug-monitoring alert can go
      // silently missing. Extract that specific field from the DOM (same
      // extractors fetchFromDom uses) so real data still reaches the evaluator,
      // and flag it in debug either way so a failure DOM extraction couldn't
      // recover is surfaced, not swallowed.
      const errors = apiResults.errors || {};
      const failedFields = ['medicationRegimen', 'problemListing', 'investigationDashboard'].filter(
        (key) => errors[key]
      );
      let medications = normalised.medications;
      let problems = normalised.problems;
      let pastProblems = normalised.pastProblems || [];
      let observations = normalised.observations;
      let observationHistory = normalised.observationHistory;
      const dataFetchFailed = {};
      if (failedFields.length > 0) {
        const M = global.SentinelMedications;
        const O = global.SentinelObservations;
        const P = global.SentinelProblems;
        if (failedFields.includes('medicationRegimen')) {
          const domMeds = M ? M.extract(document) : null;
          if (domMeds && domMeds.medications && domMeds.medications.length > 0) {
            medications = domMeds.medications;
          } else {
            dataFetchFailed.medications = true;
          }
        }
        if (failedFields.includes('problemListing')) {
          const domProbs = P ? P.extract(document) : null;
          if (domProbs && domProbs.problems && domProbs.problems.length > 0) {
            problems = domProbs.problems;
            pastProblems = [];
          } else {
            dataFetchFailed.problems = true;
          }
        }
        if (failedFields.includes('investigationDashboard')) {
          const domObs = O ? O.extract(document) : null;
          if (domObs && domObs.observations && domObs.observations.length > 0) {
            observations = domObs.observations;
            observationHistory = [];
          } else {
            dataFetchFailed.observations = true;
            dataFetchFailed.observationHistory = true;
          }
        }
      }
      return {
        mode: 'live',
        patientContext: normalised.patientContext,
        medications,
        observations,
        observationHistory,
        problems,
        pastProblems,
        debug: {
          foundHeadings: [],
          parseFailures: [],
          dataSource: errorCount > 0 ? `${apiLabel} (${errorCount} endpoint failures)` : apiLabel,
          apiErrors: apiResults.errors,
          resolutionSource,
          // Distinct "data fetch failed" signal (per CLAUDE.md drug-rules silent-
          // failure caution): set only for a field whose API call errored AND
          // whose DOM fallback also came up empty, so callers (e.g. content.js
          // computeMonitoringChip) can suppress the chip / surface an error
          // state instead of silently rendering an all-clear against data that
          // never loaded.
          dataFetchFailed: Object.keys(dataFetchFailed).length > 0 ? dataFetchFailed : null,
          counts: {
            medications: medications.length,
            observations: observations.length,
            observationHistory: observationHistory.length,
            problems: problems.length
          }
        }
      };
    } catch (e) {
      const dom = fetchFromDom();
      dom.debug.dataSource = 'dom-fallback (api exception: ' + e.message + ')';
      return dom;
    }
  }

  function fetchPatientData(mode) {
    try {
      if (mode === 'mock') return Promise.resolve(fetchMock());
      if (mode === 'discovery') return Promise.resolve(runDiscovery());
      return fetchLive();
    } catch (e) {
      return Promise.resolve({
        mode,
        patientContext: null,
        medications: [],
        observations: [],
        observationHistory: [],
        problems: [],
        debug: { foundHeadings: [], parseFailures: [], error: String(e), dataSource: 'error' },
        error: String(e)
      });
    }
  }

  const api = { fetchPatientData, fetchMock, runDiscovery, fetchLive, fetchFromDom };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelDataFetcher = api;
  }
})(typeof window !== 'undefined' ? window : global);
