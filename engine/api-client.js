// Sentinel — Medicus API Client
//
// Hits the four Medicus REST endpoints that back the patient care record UI.
// Same-origin fetch with credentials sent automatically (page cookies).
//
// Returns raw API responses; normalisation happens in normalisers.js.
//
// Endpoint pattern: {siteId}.api.england.medicus.health/{path}
// where siteId is the first path segment of the page URL.

(function(global) {
  'use strict';

  // ---- URL detection ----

  // Page is at e.g. https://england.medicus.health/560b6c/patient/...
  // API is at https://560b6c.api.england.medicus.health
  // Returns { apiBase, patientUuid, encounterUuid, siteId } or null if we can't tell.
  // If on an encounter URL, encounterUuid is set and patientUuid is null until resolved.
  // If neither URL pattern matches, the data-fetcher will try a DOM-based patient
  // UUID lookup via findPatientUuidFromDom() (universal banner-link strategy).
  function detectMedicusContext(href) {
    href = href || (typeof location !== 'undefined' ? location.href : '');
    if (!href) return null;
    let u;
    try { u = new URL(href); } catch (e) { return null; }
    if (!/medicus\.health$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const siteId = parts[0];
    if (!/^[0-9a-f]{4,}$/i.test(siteId)) return null;
    const apiHost = `${siteId}.api.${u.hostname}`;
    const apiBase = `${u.protocol}//${apiHost}`;
    const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

    let patientUuid = null;
    let encounterUuid = null;
    let taskUuid = null;
    let taskTypeSlug = null;

    // Direct patient UUID patterns
    const careRecordMatch = u.pathname.match(/\/care-record\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (careRecordMatch) patientUuid = careRecordMatch[1];
    if (!patientUuid) {
      const patientMatch = u.pathname.match(/\/patient\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!.*care-record)/i);
      if (patientMatch) patientUuid = patientMatch[1];
    }

    // Also check query string for patientId= parameter (some Medicus views use this)
    if (!patientUuid) {
      const qpId = u.searchParams.get('patientId') || u.searchParams.get('patient');
      if (qpId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qpId)) {
        patientUuid = qpId;
      }
    }

    // Encounter / consultation URL patterns - the UUID is an encounter id, not a patient id.
    // /clinical/encounter/overview/{encounterUuid}
    // /clinical/encounter/edit/{encounterUuid}
    if (!patientUuid) {
      const encounterMatch = u.pathname.match(/\/clinical\/encounter\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (encounterMatch) encounterUuid = encounterMatch[1];
    }

    // Task overview URL patterns - the UUID is a task id, not a patient id.
    // Covers prescription requests, investigation results, medical requests, general tasks,
    // and any other task type whose overview page follows the
    // /tasks/data/{type-slug}/overview/{taskUuid} pattern.
    // Resolved via the corresponding API endpoint (returns data.patient.id).
    if (!patientUuid && !encounterUuid) {
      const taskMatch = u.pathname.match(/\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (taskMatch) {
        taskTypeSlug = taskMatch[1];
        taskUuid = taskMatch[2];
      }
    }

    return { apiBase, patientUuid, encounterUuid, taskUuid, taskTypeSlug, siteId };
  }

  // ---- Universal DOM-based patient UUID resolver ----
  //
  // Used when neither the URL nor an encounter resolver gives us a patient UUID.
  // Works on every Medicus screen that shows a patient banner (tasks, prescription
  // requests, documents, appointments, results review, anywhere with the patient
  // strip across the top).
  //
  // STRICT SAFETY GUARD: returns a UUID only if EXACTLY ONE distinct patient UUID
  // is found on the page. If zero (not on a patient screen) or multiple (a list
  // view referencing many patients), returns null. This prevents wrong-patient
  // hazards on multi-patient screens.
  //
  // Strategies, in order:
  //   1. Explicit data attributes: [data-patient-id], [data-patient], [data-pid]
  //   2. Links to /care-record/{uuid} — gather all distinct UUIDs found
  //   3. Links to /patient/{uuid}
  //
  // Returns the UUID string, or null.
  function findPatientUuidFromDom(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    const UUID_RE_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const UUID_RE_GREEDY = /\/(?:care-record|patient)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

    // Strategy 1: explicit data attributes (most authoritative if present)
    const dataAttrEls = doc.querySelectorAll('[data-patient-id], [data-patientid], [data-patient], [data-pid]');
    const dataAttrUuids = new Set();
    dataAttrEls.forEach(el => {
      const v = el.getAttribute('data-patient-id')
            || el.getAttribute('data-patientid')
            || el.getAttribute('data-patient')
            || el.getAttribute('data-pid');
      if (v && UUID_RE_STRICT.test(v)) dataAttrUuids.add(v.toLowerCase());
    });
    if (dataAttrUuids.size === 1) return Array.from(dataAttrUuids)[0];
    if (dataAttrUuids.size > 1) return null; // multi-patient screen, refuse to guess

    // Strategy 2 & 3: scan all anchor hrefs for /care-record/{uuid} or /patient/{uuid}
    const linkUuids = new Set();
    const links = doc.querySelectorAll('a[href]');
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      // Reset the regex each iteration since it's global
      const re = new RegExp(UUID_RE_GREEDY.source, 'gi');
      let m;
      while ((m = re.exec(href)) !== null) {
        linkUuids.add(m[1].toLowerCase());
      }
    });
    if (linkUuids.size === 1) return Array.from(linkUuids)[0];
    // Zero or multiple → don't guess
    return null;
  }

  // ---- Fetch wrappers ----

  function safeFetch(url, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    })
      .then(async r => {
        clearTimeout(timer);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        try { return await r.json(); }
        catch (e) { throw new Error('JSON parse: ' + e.message); }
      })
      .catch(e => {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw new Error('timeout');
        throw e;
      });
  }

  // ---- Endpoint methods ----

  function fetchBanner(apiBase, uuid) {
    return safeFetch(`${apiBase}/patient/data/patient/patient-banner/${uuid}`);
  }
  function fetchMedicationRegimen(apiBase, uuid) {
    return safeFetch(`${apiBase}/clinical/data/medication/medication-regimen/${uuid}`);
  }
  function fetchProblemListing(apiBase, uuid) {
    return safeFetch(`${apiBase}/clinical/data/problem/listing/${uuid}`);
  }
  function fetchInvestigationDashboard(apiBase, uuid) {
    return safeFetch(`${apiBase}/care-record/data/investigation/dashboard/${uuid}`);
  }

  // Resolve an encounter UUID to its patient UUID via the encounter overview endpoint.
  // Used when the page is on a consultation/encounter view where only the encounter
  // UUID appears in the URL. Cached separately from patient data because the mapping
  // is stable for the lifetime of the encounter.
  const ENCOUNTER_PATIENT_CACHE = new Map();
  const ENCOUNTER_PATIENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  async function resolveEncounterToPatient(apiBase, encounterUuid) {
    if (!encounterUuid) return null;
    const k = `${apiBase}|${encounterUuid}`;
    const entry = ENCOUNTER_PATIENT_CACHE.get(k);
    if (entry && (Date.now() - entry.at) < ENCOUNTER_PATIENT_TTL_MS) return entry.patientUuid;
    try {
      const data = await safeFetch(`${apiBase}/clinical/data/encounter/overview/${encounterUuid}`);
      const patientUuid = data?.patient?.id
        || data?.consultationTopics?.[0]?.patientId
        || null;
      if (patientUuid) ENCOUNTER_PATIENT_CACHE.set(k, { at: Date.now(), patientUuid });
      return patientUuid;
    } catch (e) {
      return null;
    }
  }

  // Resolve a task UUID to its patient UUID via the corresponding task overview endpoint.
  // Task overview pages follow the pattern /tasks/data/{type-slug}/overview/{taskUuid}
  // and the response carries data.patient.id (and/or data.patientId).
  //
  // Medicus task-list URLs use snake_case internal type names (e.g.
  // prescription_request_task_routine) but the overview endpoints use shorter
  // kebab-case slugs (e.g. prescription-requests).  TASK_SLUG_OVERRIDES maps
  // known internal types to their overview slugs; unknown types fall through.
  const TASK_SLUG_OVERRIDES = {
    'prescription_request_task_routine':     'prescription-requests',
    'prescription_request_task_non_routine': 'prescription-requests',
    'medical_patient_request_task':          'medical-requests',
    'admin_patient_request_task':            'admin',
    'review_investigation_results_task':     'investigation-results',
    'document_task':                         'document',
  };

  const TASK_PATIENT_CACHE = new Map();
  const TASK_PATIENT_TTL_MS = 5 * 60 * 1000;

  async function resolveTaskToPatient(apiBase, taskTypeSlug, taskUuid) {
    if (!taskTypeSlug || !taskUuid) return null;
    const overviewSlug = TASK_SLUG_OVERRIDES[taskTypeSlug] || taskTypeSlug;
    const k = `${apiBase}|${overviewSlug}|${taskUuid}`;
    const entry = TASK_PATIENT_CACHE.get(k);
    if (entry && (Date.now() - entry.at) < TASK_PATIENT_TTL_MS) return entry.patientUuid;
    try {
      const data = await safeFetch(`${apiBase}/tasks/data/${overviewSlug}/overview/${taskUuid}`);
      const patientUuid = data?.data?.patient?.id
        || data?.data?.patientId
        || data?.patient?.id
        || data?.patientId
        || null;
      if (patientUuid) TASK_PATIENT_CACHE.set(k, { at: Date.now(), patientUuid });
      return patientUuid;
    } catch (e) {
      console.warn('[ClinHUD] resolveTaskToPatient failed for slug', overviewSlug, '(raw:', taskTypeSlug, '):', e.message);
      return null;
    }
  }

  // ---- In-memory cache (per-patient, TTL-based) ----

  const CACHE = new Map();
  const CACHE_TTL_MS = 60 * 1000; // 60 seconds
  const IN_FLIGHT = new Map(); // key -> Promise (dedup concurrent fetches)

  function cacheKey(apiBase, uuid, endpoint) {
    return `${apiBase}|${uuid}|${endpoint}`;
  }

  function getCached(apiBase, uuid, endpoint) {
    const k = cacheKey(apiBase, uuid, endpoint);
    const entry = CACHE.get(k);
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
      CACHE.delete(k);
      return null;
    }
    return entry.data;
  }

  function setCached(apiBase, uuid, endpoint, data) {
    CACHE.set(cacheKey(apiBase, uuid, endpoint), { at: Date.now(), data });
  }

  function clearCache() { CACHE.clear(); }

  // ---- Combined fetch ----
  // Fetches all four endpoints in parallel. Returns:
  //   { banner, medicationRegimen, problemListing, investigationDashboard, errors }
  // Each may be null if that endpoint failed; errors carries the messages.
  async function fetchAll(apiBase, uuid, opts) {
    opts = opts || {};
    const useCache = opts.useCache !== false;
    const endpoints = [
      ['banner', fetchBanner],
      ['medicationRegimen', fetchMedicationRegimen],
      ['problemListing', fetchProblemListing],
      ['investigationDashboard', fetchInvestigationDashboard]
    ];
    const results = { banner: null, medicationRegimen: null, problemListing: null, investigationDashboard: null, errors: {} };
    const promises = endpoints.map(async ([key, fn]) => {
      if (useCache) {
        const cached = getCached(apiBase, uuid, key);
        if (cached) { results[key] = cached; return; }
      }
      const k = cacheKey(apiBase, uuid, key);
      try {
        let promise;
        if (IN_FLIGHT.has(k)) {
          promise = IN_FLIGHT.get(k);
        } else {
          promise = fn(apiBase, uuid);
          IN_FLIGHT.set(k, promise);
          promise.finally(() => IN_FLIGHT.delete(k));
        }
        const data = await promise;
        results[key] = data;
        setCached(apiBase, uuid, key, data);
      } catch (e) {
        results.errors[key] = e.message || String(e);
      }
    });
    await Promise.all(promises);
    return results;
  }

  const api = {
    detectMedicusContext,
    findPatientUuidFromDom,
    resolveEncounterToPatient,
    resolveTaskToPatient,
    fetchBanner,
    fetchMedicationRegimen,
    fetchProblemListing,
    fetchInvestigationDashboard,
    fetchAll,
    clearCache,
    CACHE_TTL_MS
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelApiClient = api;
  }
})(typeof window !== 'undefined' ? window : global);
