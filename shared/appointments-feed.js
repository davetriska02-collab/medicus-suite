// Medicus Suite — shared my-appointments fetcher (audit M10)
//
// Before this file, THREE independent pollers each fetched
// /scheduling/data/homepage/my-appointments on their own cadence:
//   panel.js WR strip (30s, global), the Sentinel module's pinned
//   waiting-room block (30s while active) and the Today module's WR card —
// so with Sentinel or Today open the same authenticated GET went out two or
// three times per poll window. This memo coalesces them: one fetch per
// practice code per TTL window, concurrent callers share the in-flight
// promise, and each consumer keeps its OWN mapping/rendering of the raw
// payload (they extract different fields).
//
// Semantics preserved from the original call sites:
//   - Practice code is re-resolved on EVERY call (user changes take effect
//     immediately; the memo is keyed by code so a code change is a miss).
//   - Errors are NOT cached — a failed fetch leaves the last good memo in
//     place and the error propagates to the caller, which keeps its own
//     retain-last-good / hide-strip behaviour.
//   - `bypassCache: true` forces a fresh fetch (used by user-initiated
//     refreshes), still updating the shared memo for everyone else.
//
// NB: when concurrent callers coalesce, the ApiDiag diagnostics row is
// attributed to whichever module's call started the fetch — an accepted
// approximation, noted here so the diag view isn't misread as a missing
// poller.
//
// Loaded as a classic script in panel.html / pop-out.html; dual-mode export
// for the Node test suite.

(function (global) {
  'use strict';

  const TTL_MS = 15 * 1000;

  // Factory so tests can build isolated instances with injected deps.
  function createAppointmentsFeed(deps) {
    const resolveCode = deps.resolveCode; // async () => { code, source }
    const diagFetch = deps.diagFetch; // async ({ module, url, code, codeSource }) => Response
    const now = deps.now || Date.now;

    let _memo = null; // { code, ts, raw }
    let _inflight = null; // { code, promise }

    async function fetchRaw(opts) {
      const module = (opts && opts.module) || 'appointments-feed';
      const bypassCache = !!(opts && opts.bypassCache);
      const { code, source } = await resolveCode();
      if (!code) return { raw: null, code: null, source: source || null, cached: false };
      if (!bypassCache) {
        if (_memo && _memo.code === code && now() - _memo.ts < TTL_MS) {
          return { raw: _memo.raw, code, source, cached: true };
        }
        if (_inflight && _inflight.code === code) return _inflight.promise;
      }
      const url = `https://${code}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
      const p = (async () => {
        try {
          const r = await diagFetch({ module, url, code, codeSource: source });
          const raw = await r.json();
          _memo = { code, ts: now(), raw };
          return { raw, code, source, cached: false };
        } finally {
          // Clear only our own registration — a bypassCache fetch must not
          // clobber a later in-flight entry.
          if (_inflight && _inflight.promise === p) _inflight = null;
        }
      })();
      if (!bypassCache) _inflight = { code, promise: p };
      return p;
    }

    return { fetchRaw, _TTL_MS: TTL_MS };
  }

  // The one shared arrived-patients filter every consumer applied identically.
  // Kept here so the three copies can't drift; mapping beyond this differs
  // per consumer and stays at the call sites.
  function arrivedEntries(raw) {
    return (raw?.schedule?.schedule ?? [])
      .flatMap((d) => d.entries ?? [])
      .filter((e) => e?.diaryEntryType?.value === 'appointment' && e?.displayStatus?.value === 'arrived');
  }

  const api = { createAppointmentsFeed, arrivedEntries, TTL_MS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AppointmentsFeedLib = api;
    // Live singleton for the panel/pop-out pages (PracticeCode/ApiDiag load
    // before this file there).
    Object.defineProperty(global, 'AppointmentsFeed', {
      configurable: true,
      get() {
        // Lazy: PracticeCode/ApiDiag are classic scripts loaded before this
        // one, but building lazily keeps load-order coupling to a minimum.
        if (!this.__appointmentsFeedSingleton) {
          this.__appointmentsFeedSingleton = createAppointmentsFeed({
            resolveCode: () => global.PracticeCode.resolve(),
            diagFetch: (a) => global.ApiDiag.fetch(a),
          });
          this.__appointmentsFeedSingleton.arrivedEntries = arrivedEntries;
        }
        return this.__appointmentsFeedSingleton;
      },
    });
  }
})(typeof self !== 'undefined' ? self : this);
