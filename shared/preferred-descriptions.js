// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — generic per-key "what does this practice prefer" tally +
// manual-override learning. Shared between content-scripts/
// problem-description-cleanup.js (writes a tally entry on every successful
// "Clean up code" save) and options.js (renders the review/override panel).
// See shared/io/problem-description-cleanup-io.js for the storage layer.
//
// WHY THIS EXISTS: confirmedReplacementAlternatives' own comment in
// problem-description-cleanup.js notes there is no preferred-term/
// acceptability signal in Medicus's own search response to rank synonyms
// by, so every category in that file just shows every synonym and makes the
// clinician pick. This module is that missing signal, learned locally from
// what a PRACTICE actually picks over time, rather than guessed.
//
// GENERALISED 2026-07-29 (was descriptionId-specific): serves TWO distinct
// axes on the same mechanism, each its own top-level storage key:
//   1. pdc.preferredDescriptions[conceptId] — "which WORDING does this
//      practice prefer for code X" (a cosmetic relabel, same conceptId
//      throughout). key = descriptionId, candidate = {description,
//      descriptionId}.
//   2. pdc.conceptRemap[sourceConceptId] — "which OTHER code has this
//      practice actually replaced code X with" (a genuine recode — the
//      motivating real case: "Injection into varicose vein of leg"
//      449705007 manually replaced with "Injection of varicose vein of
//      lower limb" 449708009; a materially different, higher-confidence
//      signal than crossConceptAlternatives' text-coincidence matching,
//      since it's a real practice precedent, not a guess — still requires
//      explicit clinician confirmation before applying, same as everywhere
//      else in this file). key = targetConceptId + '|' + targetDescriptionId,
//      candidate = {conceptId, descriptionId, description}.
// Both axes use the exact same tally/override/resolve mechanics below — the
// only difference is what the CALLER treats as the key and what shape it
// stores as the candidate. Kept entity-agnostic and free of window/document/
// fetch/chrome.storage (same split rationale as shared/coding-specificity.js)
// — the caller owns reading/writing the entry to chrome.storage.local.
//
// ENTRY SHAPE (one per top-level key — conceptId for axis 1, sourceConceptId
// for axis 2):
//   {
//     tally: { [key]: { candidate, count, lastUsed } },
//     override: { key, candidate } | null
//   }

(function (global) {
  'use strict';

  function emptyEntry() {
    return { tally: {}, override: null };
  }

  // Never throws on a malformed/missing entry — mirrors
  // stripGenericAdditionalInfoLines' "null in -> empty out" discipline
  // elsewhere in this codebase.
  function normaliseEntry(entry) {
    if (!entry || typeof entry !== 'object') return emptyEntry();
    var tally = entry.tally && typeof entry.tally === 'object' ? entry.tally : {};
    var override =
      entry.override && typeof entry.override === 'object' && entry.override.key
        ? { key: entry.override.key, candidate: entry.override.candidate }
        : null;
    return { tally: tally, override: override };
  }

  // The manual override always wins when set (per explicit practice
  // decision) — tallying continues underneath it regardless (see
  // recordChoice), so the practice can see real usage against the pinned
  // choice without it ever silently overriding the pin. Falls back to the
  // tally entry with the highest count, tie-broken by most recently used (a
  // fresher signal beats a stale one when counts are equal). Returns null if
  // there's nothing recorded at all.
  function resolvePreferred(entry) {
    var e = normaliseEntry(entry);
    if (e.override) {
      return { key: e.override.key, candidate: e.override.candidate, source: 'override' };
    }
    var best = null;
    Object.keys(e.tally).forEach(function (key) {
      var row = e.tally[key];
      if (!row) return;
      if (
        !best ||
        row.count > best.row.count ||
        (row.count === best.row.count && (row.lastUsed || '') > (best.row.lastUsed || ''))
      ) {
        best = { key: key, row: row };
      }
    });
    if (!best) return null;
    return { key: best.key, candidate: best.row.candidate, source: 'tally' };
  }

  // Pure — returns a NEW entry object, never mutates the one passed in (same
  // functional style as descendantAlternatives/hintExpandedAlternatives in
  // shared/coding-specificity.js). `entry` may be null/undefined (first time
  // this top-level key has ever been chosen). `now` is injectable for tests,
  // defaulting to the real clock. A falsy `key` is a no-op — nothing stable
  // to tally against, same "don't guess" discipline as
  // confirmedReplacementAlternative returning null instead of inventing one.
  function recordChoice(entry, key, candidate, now) {
    var e = normaliseEntry(entry);
    if (!key) return e;
    var ts = now || new Date().toISOString();
    var existing = e.tally[key];
    var nextTally = {};
    Object.keys(e.tally).forEach(function (k) {
      nextTally[k] = e.tally[k];
    });
    nextTally[key] = {
      candidate: candidate !== undefined ? candidate : (existing && existing.candidate) || null,
      count: (existing ? existing.count : 0) + 1,
      lastUsed: ts,
    };
    return { tally: nextTally, override: e.override };
  }

  function setOverride(entry, key, candidate) {
    var e = normaliseEntry(entry);
    if (!key) return e;
    return { tally: e.tally, override: { key: key, candidate: candidate !== undefined ? candidate : null } };
  }

  function clearOverride(entry) {
    var e = normaliseEntry(entry);
    return { tally: e.tally, override: null };
  }

  var api = {
    emptyEntry: emptyEntry,
    normaliseEntry: normaliseEntry,
    resolvePreferred: resolvePreferred,
    recordChoice: recordChoice,
    setOverride: setOverride,
    clearOverride: clearOverride,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSPreferredDescriptions = api;
  }
  // globalThis, not `window : global`: this file also loads via importScripts
  // in the MV3 service worker, where neither `window` nor Node's `global`
  // exists — either bare identifier would throw a ReferenceError at import
  // time and silently take shared/io/problem-description-cleanup-io.js (which
  // needs MSPreferredDescriptions) down with it.
})(globalThis);
