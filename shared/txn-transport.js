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
  //   timeoutMs,            // abort the proxy call after this long; default 10000
  // })
  function createProxyTransport(cfg) {
    const c = cfg || {};
    const doFetch = c.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    const timeoutMs = c.timeoutMs || 10000;

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

      // Old environments (and some test stubs) may not have AbortController — in
      // that case we skip the timeout entirely and behave exactly as before.
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer = null;
      let resp;
      try {
        if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
        resp = await doFetch(`${String(c.proxyUrl).replace(/\/+$/, '')}/proxy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cred}` },
          body: JSON.stringify(payload),
          ...(controller ? { signal: controller.signal } : {}),
        });
      } catch (e) {
        if (controller && controller.signal.aborted) {
          const err = new Error(`txn proxy timeout after ${timeoutMs}ms`);
          err.isTimeout = true;
          err.isWrite = !!isWrite; // writes must NEVER be silently retried or fallen back
          throw err;
        }
        e.isWrite = !!isWrite; // writes must NEVER be silently retried or fallen back
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
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
