// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Transactional data source
//
// The fourth feed for SentinelDataFetcher: calls the proxy for the GP Connect
// Structured care record + demographics, runs the FHIR normaliser, and returns
// the SAME bundle the rule engine already consumes (engine/data-fetcher.js).
//
// Wires together the pieces already built: txn-transport (-> proxy), txn-api
// (typed endpoints), fhir-normaliser (FHIR -> engine bundle).

(function (global) {
  'use strict';

  // createTransactionalSource({
  //   txnApi,          // TxnApi.createTxnApi({ baseUrl, fetchFn: proxyTransport })
  //   getTenant, getEnvironment, getUserEmail,   // async resolvers
  //   normaliseCareRecord,  // SentinelFhirNormaliser.normaliseCareRecord
  // })
  function createTransactionalSource(cfg) {
    const c = cfg || {};
    const normalise =
      c.normaliseCareRecord || (global.SentinelFhirNormaliser && global.SentinelFhirNormaliser.normaliseCareRecord);

    // fetchFromTransactional(urlContext) -> engine bundle (or throws)
    return async function fetchFromTransactional(urlContext) {
      const patientId = urlContext && urlContext.patientUuid;
      if (!patientId) throw new Error('transactional source needs a patientUuid');

      // One round-trip each (proxy signs + forwards). Reads only.
      const [careRecord, demographics] = await Promise.all([
        c.txnApi.retrieveCareRecord(patientId),
        c.txnApi.getDemographics(patientId),
      ]);

      const bundle = normalise(careRecord, demographics, urlContext);
      bundle.debug = bundle.debug || {};
      bundle.debug.dataSource = 'transactional (proxy)';
      return bundle;
    };
  }

  const api = { createTransactionalSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SentinelTransactionalSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
