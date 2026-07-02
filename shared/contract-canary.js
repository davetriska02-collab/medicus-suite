// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — DOM Contract Canary (Horizon 1, Part 3 / Batch H2)
//
// Content-script-side RUNTIME prober for the registry in shared/dom-contracts.js
// (Batch H1). Runs the SAME contract declarations the registry defines against the
// live Medicus page, so the suite can tell "Medicus changed" from "nothing is
// wrong" without a clinician discovering a silently-broken feature first in
// clinic — the exact failure mode (v3.143.1 OIR checkboxes, v3.143.2 assignee
// picker) this whole Horizon-1 plan exists to catch.
//
// ── What this deliberately does NOT do ──────────────────────────────────────
//   - Never reads text content, attribute VALUES, or anything else that could
//     carry PHI. Every probe is DomContracts.probeContract()'s own
//     querySelectorAll(...).length counting — counts and booleans only.
//   - Does NOT add a new MutationObserver. It piggybacks on the existing
//     shared observer hub (content-scripts/dom-observer-hub.js) — see
//     CLAUDE.md "Injecting chips into the live Medicus queue" for why a
//     second body-subtree observer is the wrong tool here. The hub's
//     rAF-coalesced fan-out already represents "the DOM just settled after a
//     burst of mutations", which is exactly the moment a probe is cheap and
//     honest (mirrors how booking-inline.js / pusher-relay.js /
//     routine-rx-button.js already subscribe to the hub instead of rolling
//     their own observer).
//   - Only probes contracts flagged `runtime: true` in the registry, and only
//     on pages whose `pageMatch` fits the current URL (or `pageMatch: null`,
//     the registry's "applies everywhere" convention) — see
//     contractsForPage().
//
// ── Hysteresis (why a mid-render SPA re-render never alarms) ────────────────
// A contract's SURFACED status is one of 'ok' | 'degraded' | 'not_applicable'.
// The raw per-probe DomContracts.STATUS.FAIL is a transient signal that is
// NEVER itself surfaced (see nextContractState): it only promotes a contract
// to 'degraded' after >= 2 FAIL probes at least 30s apart with no intervening
// OK in between — Medicus's Vue+AG-Grid SPA re-renders constantly, so a
// single snapshot mid-render can legitimately look broken for a few hundred
// ms. It recovers to 'ok' on the very next OK probe: the asymmetry is
// deliberate (CLAUDE.md "false-positive discipline beats coverage" — under-
// alarming about a genuine break is the safer failure mode for a
// self-diagnostic strip, not the safer failure mode for a clinical alert).
//
// ── Storage ──────────────────────────────────────────────────────────────────
// chrome.storage.local key 'health.contracts': { [contractId]: ContractHealth }
//   ContractHealth = {
//     lastProbe:  ISO timestamp of the most recent probe,
//     status:     'ok' | 'degraded' | 'not_applicable',
//     sinceTs:    ISO timestamp the CURRENT status began,
//     probeCount: total probes ever recorded for this contract,
//     failStreak: hysteresis bookkeeping (consecutive spaced FAILs) — not
//                 meant for UI display, harmless to read,
//     lastFailTs: hysteresis bookkeeping — ISO timestamp of the last COUNTED
//                 (spaced) FAIL, or null,
//   }
// Machine-local diagnostic state — deliberately EXCLUDED from suite backup,
// same doctrine as sentinel.extractionBaseline / ledger.events (see the
// 'health' comment in test-backup-coverage.js's ALLOWLIST).
//
// All storage writes are fire-and-forget: errors are swallowed and
// console.warn'd only — exactly like shared/event-ledger.js — a throwing or
// quota-full storage layer must never break page injection.
//
// ── Ledger integration ───────────────────────────────────────────────────────
// On a transition INTO 'degraded', or FROM 'degraded' back to 'ok', one
// shared/event-ledger.js event is recorded: source 'health', patientRef null,
// action 'contract-degraded' / 'contract-recovered', label "<id> <feature>",
// deduped per contract per day via the ledger's own { dedupe: true } option.
// Establishing a contract's FIRST-ever status (unset -> ok/not_applicable) is
// not itself a "recovery" and is never logged — only real transitions are.
//
// ── Dual-mode export (same pattern as shared/dom-contracts.js / event-ledger.js) ─
//   Browser (classic content script, self-running): window.ContractCanary.<fn>(...)
//   Node / test:                                     require('./shared/contract-canary.js').<fn>(...)
// In Node the self-running browser wiring below never executes (guarded by
// isBrowserEnv()) — requiring this file is side-effect-free, just like the
// two files it composes.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'health.contracts';
  const PROBE_DEBOUNCE_MS = 5000; // >= 5s between probe ROUNDS (a round covers every applicable contract)
  const FAIL_SPACING_MS = 30000; // consecutive FAILs must be >= 30s apart to count toward hysteresis
  const FAILS_REQUIRED = 2; // this many spaced FAILs before a contract is surfaced 'degraded'

  const STATUS = { OK: 'ok', DEGRADED: 'degraded', NOT_APPLICABLE: 'not_applicable' };

  function warn(e) {
    try {
      console.warn('[ContractCanary] ignored failure:', e && e.message ? e.message : e);
    } catch (_) {
      /* console unavailable — still never throw */
    }
  }

  // ── Pure helpers (unit-tested directly in test-contract-canary.js) ─────────

  /**
   * Contracts eligible for a live probe on this page: `runtime: true`, and
   * either `pageMatch: null` (registry's "applies on any medicus.health page"
   * convention) or `pageMatch.test(href)` matches.
   */
  function contractsForPage(contracts, href) {
    const list = Array.isArray(contracts) ? contracts : [];
    const url = String(href || '');
    return list.filter((c) => {
      if (!c || c.runtime !== true) return false;
      if (c.pageMatch == null) return true;
      try {
        return c.pageMatch.test(url);
      } catch (_) {
        return false;
      }
    });
  }

  /** Debounce gate: has at least `debounceMs` elapsed since the last probe round? */
  function shouldProbeNow(lastRoundMs, nowMs, debounceMs) {
    const gap = typeof debounceMs === 'number' ? debounceMs : PROBE_DEBOUNCE_MS;
    if (lastRoundMs == null || typeof lastRoundMs !== 'number') return true;
    return nowMs - lastRoundMs >= gap;
  }

  /**
   * Advance one contract's stored health state given ONE raw probe result
   * (a DomContracts.STATUS value: 'ok' | 'fail' | 'not_applicable'). Pure —
   * does not mutate `prevState`.
   *
   * @param {object|null} prevState  Previous ContractHealth, or null/undefined
   *   for a contract probed for the first time.
   * @param {string} probeStatus     DomContracts.STATUS.{OK,FAIL,NOT_APPLICABLE}.
   * @param {string} nowIso          Current ISO timestamp (passed in for
   *   deterministic tests).
   * @returns {{ state: object, transition: null|'degraded'|'recovered' }}
   *   `transition` is set ONLY the round a hysteresis threshold is actually
   *   crossed — never repeated on every subsequent probe while it holds.
   */
  function nextContractState(prevState, probeStatus, nowIso) {
    const prev = prevState && typeof prevState === 'object' ? prevState : null;
    const prevStatus = prev ? prev.status : null;
    const nowMs = new Date(nowIso).getTime();
    const state = {
      lastProbe: nowIso,
      status: prevStatus || STATUS.NOT_APPLICABLE,
      sinceTs: prev && prev.sinceTs ? prev.sinceTs : nowIso,
      probeCount: (prev && typeof prev.probeCount === 'number' ? prev.probeCount : 0) + 1,
      failStreak: prev && typeof prev.failStreak === 'number' ? prev.failStreak : 0,
      lastFailTs: prev && prev.lastFailTs ? prev.lastFailTs : null,
    };
    let transition = null;

    if (probeStatus === 'not_applicable') {
      // Anchor absent this round — per the registry's own probe semantics,
      // never a false alarm. Doesn't count toward or against the FAIL streak
      // (we simply didn't get a reading this round, e.g. the clinician
      // navigated off the page the contract applies to); an established
      // status (ok/degraded) is left untouched. Only a first-ever probe with
      // no prior status settles to 'not_applicable'.
      if (!prevStatus) state.status = STATUS.NOT_APPLICABLE;
      return { state, transition };
    }

    if (probeStatus === 'ok') {
      state.failStreak = 0;
      state.lastFailTs = null;
      if (prevStatus === STATUS.DEGRADED) {
        state.status = STATUS.OK;
        state.sinceTs = nowIso;
        transition = 'recovered';
      } else if (prevStatus !== STATUS.OK) {
        // First-ever confirmation, or promotion from 'not_applicable' — not a
        // "recovery" (nothing was previously known broken), so no transition.
        state.status = STATUS.OK;
        state.sinceTs = nowIso;
      }
      return { state, transition };
    }

    // probeStatus === 'fail'
    if (state.failStreak === 0 || !state.lastFailTs) {
      // First fail of a fresh streak. A single FAIL is never sufficient on
      // its own — hold at whatever the contract already read (or 'ok' for a
      // first-ever probe: one sample cannot demote a status that was never
      // established).
      state.failStreak = 1;
      state.lastFailTs = nowIso;
      if (!prevStatus) state.status = STATUS.OK;
      return { state, transition };
    }
    const lastFailMs = new Date(state.lastFailTs).getTime();
    if (nowMs - lastFailMs >= FAIL_SPACING_MS) {
      state.failStreak += 1;
      state.lastFailTs = nowIso;
      if (state.failStreak >= FAILS_REQUIRED && prevStatus !== STATUS.DEGRADED) {
        state.status = STATUS.DEGRADED;
        state.sinceTs = nowIso;
        transition = 'degraded';
      }
    }
    // else: too soon since the last COUNTED fail — hold the streak exactly
    // where it is and wait for a genuinely spaced repeat, rather than either
    // resetting (which would let a burst of near-simultaneous FAILs never
    // qualify) or advancing (which would defeat the 30s spacing rule).
    return { state, transition };
  }

  /**
   * Apply one full probe round (every contract eligible on this page) to the
   * previous health map. Pure — does not mutate `prevHealth`.
   *
   * @param {object|null} prevHealth  Previous `health.contracts` value.
   * @param {Array<{id:string,status:string}>} results  One DomContracts probe
   *   result per contract (id + DomContracts.STATUS value).
   * @param {string} nowIso
   * @returns {{ health: object, transitions: Array<{id:string,transition:string}> }}
   */
  function applyProbeRound(prevHealth, results, nowIso) {
    const health = Object.assign({}, prevHealth && typeof prevHealth === 'object' ? prevHealth : {});
    const transitions = [];
    for (const r of Array.isArray(results) ? results : []) {
      if (!r || !r.id) continue;
      const { state, transition } = nextContractState(health[r.id], r.status, nowIso);
      health[r.id] = state;
      if (transition) transitions.push({ id: r.id, transition });
    }
    return { health, transitions };
  }

  // ── Live wiring (browser content-script) ────────────────────────────────

  function isBrowserEnv() {
    return (
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      typeof chrome !== 'undefined' &&
      !!(chrome.storage && chrome.storage.local)
    );
  }

  /**
   * Run one probe round against a real (or fake) DOM and persist the result.
   * Exposed (not just internal) so tests can drive it end-to-end with fake
   * `deps` — a fake DomContracts, a fake EventLedger, a fake `chrome.storage`
   * — without needing a real browser/content-script environment.
   *
   * @param {object} deps
   *   deps.DomContracts — the shared/dom-contracts.js API (list/probeContract).
   *   deps.EventLedger  — the shared/event-ledger.js API (record), optional.
   *   deps.href         — current page URL (location.href).
   *   deps.root         — probe root (document, or a fake with querySelectorAll).
   * @returns {Promise<{health:object, transitions:Array}|null>} null when
   *   there was nothing to probe on this page, or on any swallowed failure.
   */
  async function runProbeRound(deps) {
    const d = deps || {};
    const DC = d.DomContracts;
    if (!DC || typeof DC.list !== 'function' || typeof DC.probeContract !== 'function') return null;
    try {
      const nowIso = new Date().toISOString();
      const contracts = contractsForPage(DC.list(), d.href);
      if (contracts.length === 0) return null;
      const results = contracts.map((c) => {
        const r = DC.probeContract(c, d.root);
        return { id: c.id, status: r.status };
      });
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const prevHealth = (stored && stored[STORAGE_KEY]) || {};
      const { health, transitions } = applyProbeRound(prevHealth, results, nowIso);
      await chrome.storage.local.set({ [STORAGE_KEY]: health });

      const EL = d.EventLedger;
      if (EL && typeof EL.record === 'function' && transitions.length) {
        const byId = new Map(contracts.map((c) => [c.id, c]));
        for (const t of transitions) {
          const c = byId.get(t.id);
          const feature = c ? c.feature : t.id;
          const action = t.transition === 'degraded' ? 'contract-degraded' : 'contract-recovered';
          // Awaited so a caller observing runProbeRound()'s result also sees a
          // consistent ledger — but still effectively fire-and-forget: EventLedger
          // .record() is documented to never throw/reject (see shared/event-ledger.js),
          // so this can never be the reason runProbeRound's own try/catch fires.
          await EL.record(
            { source: 'health', patientRef: null, ruleId: t.id, label: `${t.id} ${feature}`, action },
            { dedupe: true }
          );
        }
      }
      return { health, transitions };
    } catch (e) {
      warn(e);
      return null;
    }
  }

  if (isBrowserEnv() && !window.__chContractCanaryStarted) {
    window.__chContractCanaryStarted = true;

    let lastRoundAtMs = null;
    let inFlight = false;

    function maybeRunRound() {
      if (inFlight) return;
      const nowMs = Date.now();
      if (!shouldProbeNow(lastRoundAtMs, nowMs, PROBE_DEBOUNCE_MS)) return;
      if (document.hidden) return; // paused while backgrounded, mirrors the hub's own gate
      inFlight = true;
      lastRoundAtMs = nowMs;
      runProbeRound({
        DomContracts: window.DomContracts,
        EventLedger: window.EventLedger,
        href: location.href,
        root: document,
      }).then(
        () => {
          inFlight = false;
        },
        () => {
          inFlight = false;
        }
      );
    }

    // Re-check when the tab returns to the foreground — mirrors
    // booking-inline.js / pusher-relay.js, which skip work while hidden.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) maybeRunRound();
    });

    const hub = window.__chObserverHub;
    if (hub && typeof hub.subscribe === 'function') {
      // Every rAF-coalesced fan-out from the shared hub IS a "DOM just
      // settled" event — no separate MutationObserver needed here (plan
      // constraint; see file header).
      hub.subscribe(maybeRunRound);
    } else {
      warn(
        'dom-observer-hub not present — continuous canary probing disabled; running the one-off page-ready probe only'
      );
    }

    // One probe on initial page-ready, independent of the hub — covers pages
    // that settle before the hub's first mutation batch, and pages that never
    // mutate again after load.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', maybeRunRound, { once: true });
    } else {
      maybeRunRound();
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const api = {
    STORAGE_KEY,
    STATUS,
    constants: { PROBE_DEBOUNCE_MS, FAIL_SPACING_MS, FAILS_REQUIRED },
    contractsForPage,
    shouldProbeNow,
    nextContractState,
    applyProbeRound,
    runProbeRound,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ContractCanary = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
