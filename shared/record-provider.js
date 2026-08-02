// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Record provider
//
// The strategy layer that lets feature modules ask for patient data WITHOUT
// caring whether it comes from the existing session/DOM path or the
// Transactional API. This is the seam that makes the migration incremental and
// reversible: flip a setting, not a rewrite.
//
// Rules:
//   - READS may fall back: transactional -> session (when allowed) so a token
//     or permission failure degrades gracefully to today's behaviour.
//   - WRITES never fall back and never auto-retry (clinical safety): if the
//     Transactional path is unavailable, the write fails loudly.

(function (global) {
  'use strict';

  // createRecordProvider({
  //   mode,            // 'session' | 'hybrid' | 'transactional'
  //   features,        // { careRecord, demographics, matchPatient, documents }
  //   sessionClient,   // existing client: { getDemographics, getCareRecord, matchPatient, ... }
  //   txnClient,       // TxnApi instance (may be null if not configured)
  //   onDiag,          // optional (entry) => void  for diagnostics/telemetry-free logging
  // })
  function createRecordProvider(opts) {
    const cfg = opts || {};
    const mode = cfg.mode || 'session';
    const features = cfg.features || {};
    const session = cfg.sessionClient || {};
    const txn = cfg.txnClient || null;
    const diag = typeof cfg.onDiag === 'function' ? cfg.onDiag : function () {};

    const txnEnabled = (mode === 'hybrid' || mode === 'transactional') && !!txn;

    // Should a given read use the Transactional path?
    function useTxnFor(feature) {
      return txnEnabled && features[feature] === true;
    }

    async function read(feature, txnFn, sessionFn) {
      if (useTxnFor(feature)) {
        try {
          const out = await txnFn();
          diag({ feature, source: 'transactional', ok: true });
          return out;
        } catch (e) {
          diag({ feature, source: 'transactional', ok: false, error: e && e.message });
          // hybrid falls back to session; pure 'transactional' surfaces the error
          if (mode !== 'hybrid' || typeof sessionFn !== 'function') throw e;
          diag({ feature, source: 'session', fallback: true });
          return sessionFn();
        }
      }
      if (typeof sessionFn !== 'function') {
        throw new Error(`No session implementation for "${feature}"`);
      }
      return sessionFn();
    }

    // ---- Reads (feature-flagged, fall back where allowed) ----
    return {
      getDemographics(patientId) {
        return read(
          'demographics',
          () => txn.getDemographics(patientId),
          session.getDemographics ? () => session.getDemographics(patientId) : null
        );
      },
      getCareRecord(patientId) {
        return read(
          'careRecord',
          () => txn.retrieveCareRecord(patientId),
          session.getCareRecord ? () => session.getCareRecord(patientId) : null
        );
      },
      matchPatient(criteria) {
        return read(
          'matchPatient',
          () => txn.matchPatient(criteria),
          session.matchPatient ? () => session.matchPatient(criteria) : null
        );
      },
      listDocuments(patientId) {
        return read(
          'documents',
          () => txn.listDocuments(patientId),
          session.listDocuments ? () => session.listDocuments(patientId) : null
        );
      },

      // ---- Writes: Transactional only, no fallback, no auto-retry ----
      async write(method, payload) {
        if (!txn) throw new Error('Transactional API not configured — writes unavailable');
        if (typeof txn[method] !== 'function') throw new Error(`Unknown write method: ${method}`);
        diag({ feature: method, source: 'transactional', write: true });
        return txn[method](payload);
      },
    };
  }

  const api = { createRecordProvider };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RecordProvider = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
