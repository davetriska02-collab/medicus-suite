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

  // Transient failures worth a retry on READS ONLY: connect/abort timeouts,
  // bare network rejections (no HTTP status at all), and these HTTP statuses.
  const RETRYABLE_STATUSES = new Set([502, 503, 504, 429]);
  const MAX_ATTEMPTS = 3;

  // createProxyTransport({
  //   proxyUrl,             // e.g. https://<proj>.supabase.co/functions/v1
  //   getCallerCredential,  // async () => string (SECRET; SW-side)
  //   getTenant,            // async () => Medicus site code (4-8 hex)
  //   getEnvironment,       // async () => 'staging' | 'prod'
  //   getUserEmail,         // async () => clinician email | null (user-restricted attribution)
  //   fetchFn,              // injectable for tests; defaults to global fetch
  //   timeoutMs,            // abort the proxy call after this long; default 10000
  //   retry: {              // READS ONLY — writes are always exactly one attempt
  //     attempts,            // total tries including the first; default 2, capped at 3
  //     backoffMs,           // base backoff; default 400
  //     jitter,              // add 0-50% random jitter to the backoff; default true
  //   },
  //   sleepFn,               // injectable for tests; defaults to real setTimeout-based sleep
  //   randomFn,              // injectable for tests; defaults to Math.random
  // })
  function createProxyTransport(cfg) {
    const c = cfg || {};
    const doFetch = c.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    const timeoutMs = c.timeoutMs || 10000;
    const retryCfg = c.retry || {};
    const configuredAttempts = retryCfg.attempts || 2;
    const maxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, configuredAttempts));
    const backoffMs = retryCfg.backoffMs || 400;
    const jitter = retryCfg.jitter !== false;
    const sleepFn = c.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const randomFn = c.randomFn || Math.random;

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

      // Writes are NEVER retried — exactly one attempt, ever.
      const totalAttempts = isWrite ? 1 : maxAttempts;

      let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          return await attemptOnce();
        } catch (e) {
          e.isWrite = !!isWrite; // writes must NEVER be silently retried or fallen back
          const canRetry = !isWrite && attempt < totalAttempts && isTransient(e);
          if (!canRetry) {
            e.attempts = attempt;
            throw e;
          }
          const base = backoffMs * Math.pow(2, attempt - 1);
          const wait = jitter ? base + randomFn() * 0.5 * base : base;
          await sleepFn(wait);
        }
      }

      async function attemptOnce() {
        // Old environments (and some test stubs) may not have AbortController
        // — in that case we skip the timeout entirely and behave exactly as
        // before. Each attempt gets its own fresh controller/timer.
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
            throw err;
          }
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
          throw err;
        }
        return data;
      }
    };
  }

  function isTransient(err) {
    if (err.isTimeout) return true;
    if (typeof err.status === 'number') return RETRYABLE_STATUSES.has(err.status);
    return true; // bare network-level rejection (no HTTP status at all)
  }

  const api = { createProxyTransport };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnTransport = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
