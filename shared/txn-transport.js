// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Transactional proxy transport
//
// The Medicus Transactional API is server-to-server only, so the extension
// reaches it through OUR backend proxy: this transport POSTs the intended call
// ({method, path, body}) plus tenant/environment/userEmail to {proxyUrl}/proxy,
// and the proxy signs a short-lived Medicus JWT and forwards it. The proxy
// caller credential stays in the SERVICE WORKER — this module must never be
// loaded into a page/content-script context with a real credential.
//
// Produces a `fetchFn` compatible with TxnApi.createTxnApi.

(function (global) {
  'use strict';

  // createProxyTransport({
  //   proxyUrl,             // e.g. https://<proj>.supabase.co/functions/v1
  //   getCallerCredential,  // async () => string (SECRET; SW-side)
  //   getTenant,            // async () => Medicus site code (4-8 hex)
  //   getEnvironment,       // async () => 'staging' | 'prod'
  //   getUserEmail,         // async () => clinician email | null (user-restricted attribution)
  //   fetchFn,              // injectable for tests; defaults to global fetch
  // })
  function createProxyTransport(cfg) {
    const c = cfg || {};
    const doFetch = c.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);

    return async function transport({ method, path, body, isWrite }) {
      if (!c.proxyUrl) throw new Error('txn proxy URL not configured');
      if (!doFetch) throw new Error('no fetch available');
      const cred = c.getCallerCredential ? await c.getCallerCredential() : null;
      if (!cred) throw new Error('txn caller credential not configured');

      const payload = {
        tenant: c.getTenant ? await c.getTenant() : undefined,
        environment: c.getEnvironment ? await c.getEnvironment() : 'staging',
        method,
        path,
      };
      if (body !== undefined && body !== null) payload.body = body;
      const email = c.getUserEmail ? await c.getUserEmail() : null;
      if (email) payload.userEmail = email;

      const resp = await doFetch(`${String(c.proxyUrl).replace(/\/+$/, '')}/proxy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cred}` },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        data = text;
      }
      if (!resp.ok) {
        const err = new Error(`txn proxy ${resp.status}: ${(data && data.error) || 'error'}`);
        err.status = resp.status;
        err.isWrite = !!isWrite; // writes must NEVER be silently retried or fallen back
        throw err;
      }
      return data;
    };
  }

  const api = { createProxyTransport };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnTransport = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
