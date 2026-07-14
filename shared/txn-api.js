// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Transactional API client
//
// Typed wrapper over the Medicus Transactional API. All 15 documented endpoints.
// Transport is INJECTED (`fetchFn`) so the extension can route through the
// service-worker (which attaches `Authorization: Bearer <jwt>` from the token
// broker) and through ApiDiag for diagnostics, while tests use a mock.
//
// ⚠️ Assumes the extension may call Medicus directly (browser origin). If Medicus
// is server-to-server only, swap `fetchFn` for a backend-proxy call — no endpoint
// method below changes. (Plan §7, unknown #1.)
//
// SAFETY: read methods may be retried/fallen-back by the caller; WRITE methods
// (create*, markPatientAsArrived) must NEVER be silently retried or fallen back.

(function (global) {
  'use strict';

  const PREFIX = '/transactional-api';

  // createTxnApi({
  //   baseUrl,   // string, tenant-scoped (see TxnConfig.baseUrl)
  //   fetchFn,   // async ({ method, path, body, isWrite }) => parsed JSON
  // })
  function createTxnApi(opts) {
    const cfg = opts || {};
    if (!cfg.baseUrl) throw new Error('baseUrl required');
    if (typeof cfg.fetchFn !== 'function') throw new Error('fetchFn required');

    function call(method, path, body, isWrite) {
      return cfg.fetchFn({
        method,
        url: `${cfg.baseUrl}${PREFIX}${path}`,
        path: `${PREFIX}${path}`,
        body: body || null,
        isWrite: !!isWrite,
      });
    }
    const GET = (p) => call('GET', p, null, false);
    const POST = (p, b) => call('POST', p, b, false);
    const WRITE = (p, b) => call('POST', p, b, true); // mutating POST

    return {
      // ---- Reads ----
      ping: () => GET('/ping'),
      findPatient: (query) => POST('/find-patient', { query }),
      matchPatient: (criteria) => POST('/match-patient', criteria),
      getDemographics: (patientId) => GET(`/patient/${encodeURIComponent(patientId)}/demographics`),
      retrieveCareRecord: (patientId) => POST('/retrieve-care-record', { patientId }),
      listDocuments: (patientId) => POST('/list-documents', { patientId }),
      retrieveDocument: (binaryId) => GET(`/retrieve-document/Binary/${encodeURIComponent(binaryId)}`),
      listStaff: () => GET('/list-staff'),
      findAppointmentsForCheckIn: (patientId) => POST('/find-appointments-for-check-in', { patientId }),

      // ---- Writes (mutating; require user-restricted token + confirmation upstream) ----
      createNote: (payload) => WRITE('/create-note', payload),
      createObservation: (payload) => WRITE('/create-observation', payload),
      createDocument: (payload) => WRITE('/create-document', payload),
      createOutboundReferral: (payload) => WRITE('/create-outbound-referral', payload),
      createEncounter: (payload) => WRITE('/create-encounter', payload),
      markPatientAsArrived: (appointmentId) => WRITE('/mark-patient-as-arrived', { appointmentId }),
    };
  }

  const api = { createTxnApi, PREFIX };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TxnApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
