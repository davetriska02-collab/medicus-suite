// engine/eval-cache.js — record-pipeline evaluation memo
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// The record HUD re-runs the full monitoring pipeline on every render/poll:
// fetch patient data → engine.evaluatePatient over every rule × observation.
// The fetch must stay fresh (a cached fetch could serve a stale "all-clear"
// after a new result is filed mid-consult — the one failure mode we will not
// ship). What is safe to skip is the O(rules × observations) RE-EVALUATION when
// the freshly-fetched data is byte-identical to the previous run.
//
// So this memo caches ONLY the evaluation output, keyed by:
//   (a) a patient/page token (caller supplies — navigation changes it), and
//   (b) a content hash of the freshly-fetched evaluation inputs.
// Because the hash is computed from data fetched fresh on every call, the cache
// is self-invalidating: any change to meds/observations/problems/rules/day
// yields a different hash → a miss → a real re-evaluation. It can never return
// a result that does not match the current data. An explicit invalidate() is
// also exposed for navigation / sign-out.
//
// Dual-mode (Node require OR browser global), mirroring engine/acb-scores.js.

(function (global) {
  'use strict';

  // Stable, cheap content hash of everything evaluatePatient's output depends on.
  // Deliberately NOT a full deep serialise — just the fields that change a chip:
  //   - medications: name + startDate (drives drug match + recently-initiated)
  //   - observations: name + date + value (drives intervals + thresholds)
  //   - problems: label (drives register / requiresProblem gates)
  //   - patientContext: ageYears + sex (drives age/sex filters)
  //   - rules: a signature so a config change busts the cache
  //   - day: now bucketed to YYYY-MM-DD — interval/overdue status only changes
  //     across day boundaries, so same-day re-evaluation of identical data is a
  //     genuine no-op, but a new day re-evaluates (an overdue can tick over).
  function computeInputHash(medications, observations, opts) {
    opts = opts || {};
    const meds = (medications || [])
      .map((m) => `${m && m.name ? String(m.name).toLowerCase() : ''}@${(m && m.startDate) || ''}`)
      .sort()
      .join('|');
    const obs = (observations || [])
      .map(
        (o) =>
          `${o && o.name ? String(o.name).toLowerCase() : ''}@${(o && o.date) || ''}=${o && o.value != null ? o.value : ''}`
      )
      .sort()
      .join('|');
    const probs = (opts.problems || [])
      .map((p) => (p && p.label ? String(p.label).toLowerCase() : ''))
      .sort()
      .join('|');
    const pc = opts.patientContext || {};
    const ctx = `${pc.ageYears != null ? pc.ageYears : ''}/${pc.sex || ''}`;
    const day = (opts.now ? String(opts.now) : new Date().toISOString()).slice(0, 10);
    const rulesSig = rulesSignature(opts.rules);
    return djb2(`M:${meds}\nO:${obs}\nP:${probs}\nC:${ctx}\nR:${rulesSig}\nD:${day}`);
  }

  // A cheap signature of the active ruleset — count + each rule's id plus a
  // stable serialisation of the rule's full content (thresholds, match/exclude
  // lists, intervals, enabled flag, etc.) so an edited rule busts the cache even
  // when its id and enabled flag are unchanged. Order-independent.
  function rulesSignature(rules) {
    if (!Array.isArray(rules)) return '0';
    return (
      rules.length +
      ':' +
      rules
        .map((r) => `${(r && (r.id || r.indicatorCode)) || '?'}~${stableStringify(r)}`)
        .sort()
        .join(',')
    );
  }

  // Deterministic JSON.stringify: object keys are sorted recursively so that
  // two objects with the same content in different key order (e.g. after a
  // round-trip through storage) produce identical output — unrelated
  // re-serialisation must not spuriously bust the cache.
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  // Small, fast string hash (djb2). Collisions are astronomically unlikely for
  // our inputs and a collision would at worst skip one re-eval of identical-
  // looking data — never serve a wrong-patient result (the token key guards that).
  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
  }

  // The memo store. One entry per token; each holds the last hash + value.
  function createEvalCache() {
    const store = new Map(); // token → { hash, value }
    return {
      // Returns the cached value iff this token was last computed with this exact
      // hash; otherwise undefined (caller must compute). Never returns a value
      // for a different hash — that is what makes a stale all-clear impossible.
      get(token, hash) {
        const e = store.get(token);
        if (e && e.hash === hash) return e.value;
        return undefined;
      },
      set(token, hash, value) {
        store.set(token, { hash, value });
        return value;
      },
      // Drop one token (navigation to a different patient) or everything.
      invalidate(token) {
        if (token == null) store.clear();
        else store.delete(token);
      },
      get size() {
        return store.size;
      },
    };
  }

  const api = { computeInputHash, rulesSignature, createEvalCache, _djb2: djb2 };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelEvalCache = api;
  }
})(typeof window !== 'undefined' ? window : global);
