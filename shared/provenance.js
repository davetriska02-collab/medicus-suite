// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — provenance & caveat canon
//
// Why this exists: the suite shows operational and clinical figures across many
// surfaces (Capacity, Today, Referrals, Activity, Condor, Record, CQC). Two bits
// of clinical-safety furniture were expressed ad-hoc and INCONSISTENTLY:
//
//   1. Provenance — what a figure is derived from, its as-of timestamp, and the
//      "this is supporting evidence, not proof / a live snapshot, not a complete
//      record" framing — was hand-written per module.
//   2. The "no alert ≠ all clear" caveat (absence of a flag is not assurance) was
//      triplicated in slightly different wording (sweep.js, reception.js,
//      side-panel sentinel.js).
//
// This module canonicalises those strings so every surface carries the SAME
// honest wording. It invents no new clinical claim — each constant is the
// wording already most prevalent / best in the codebase, lifted verbatim.
//
// Dual-mode (Node require OR browser global), mirroring engine/acb-scores.js:
//   const { CAVEATS, formatProvenance } = require('./shared/provenance.js'); // Node
//   window.Provenance.CAVEATS.NO_ALERT_NOT_ALL_CLEAR                         // browser

(function (global) {
  'use strict';

  // ── Canonical caveat strings ────────────────────────────────────────────────
  // One constant per DISTINCT caveat. Plain text (no HTML entities): callers
  // escape / wrap for their own surface. Tails that are module-specific (e.g.
  // "the Monitoring tab has the full picture") are appended by the caller, never
  // baked in here — so the shared assertion stays identical everywhere.

  // Absence of an alert is not assurance that monitoring is complete. The signature
  // clinical-safety line of the suite (praised, unprompted, in the practice
  // appraisals — "Rare and right. Do not dilute."). Lifted from sweep.js.
  const NO_ALERT_NOT_ALL_CLEAR = 'No alert ≠ monitoring complete.';

  // A figure or panel reflects a point-in-time read of the live system, not the
  // full record. Lifted verbatim from the Record module's load-bearing caveat.
  const LIVE_SNAPSHOT_NOT_COMPLETE =
    'Live snapshot, not a complete record. Verify against the patient record before acting.';

  // Output is supporting evidence that slots into a wider pack — never proof of
  // compliance. Lifted from the CQC readiness disclaimer strip.
  const SUPPORTING_EVIDENCE_NOT_PROOF = 'Supporting evidence, not proof.';

  const CAVEATS = {
    NO_ALERT_NOT_ALL_CLEAR,
    LIVE_SNAPSHOT_NOT_COMPLETE,
    SUPPORTING_EVIDENCE_NOT_PROOF,
  };

  // ── Provenance line formatter ────────────────────────────────────────────────
  // One consistent "<source label> · as at <timestamp>" line, so every figure
  // carries the same furniture the CQC engine already nails (see cqc-render.js
  // provenanceLine). Plain text — the caller escapes / wraps.
  //
  // No-fabrication contract: a timestamp is shown ONLY when one is supplied. A
  // missing/blank as-of value is OMITTED entirely — never defaulted to "now" or
  // any invented time, because a stamped figure that wasn't actually read then
  // would over-claim. Likewise a missing source is omitted. If neither is
  // present the function returns '' (render nothing rather than an empty stamp).
  //
  // @param {{ source?: string, asOf?: string|number|Date }} [opts]
  // @returns {string} e.g. "Slots free now · as at 09:14" or "" when no inputs.
  function formatProvenance({ source, asOf } = {}) {
    const parts = [];
    const src = typeof source === 'string' ? source.trim() : '';
    if (src) parts.push(src);

    const stamp = formatAsOf(asOf);
    if (stamp) parts.push(`as at ${stamp}`);

    return parts.join(' · ');
  }

  // Normalise an as-of value to a short clock/date string, or '' when there is
  // nothing trustworthy to show. Accepts a Date, an epoch ms number, or an
  // already-formatted string (returned trimmed, as-is). Never fabricates.
  function formatAsOf(asOf) {
    if (asOf == null || asOf === '') return '';
    if (asOf instanceof Date) {
      return Number.isNaN(asOf.getTime())
        ? ''
        : asOf.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    if (typeof asOf === 'number') {
      if (!Number.isFinite(asOf)) return '';
      const d = new Date(asOf);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    if (typeof asOf === 'string') return asOf.trim();
    return '';
  }

  // ── Module export (dual-mode: Node require OR browser global) ───────────────
  const api = { CAVEATS, formatProvenance, formatAsOf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Provenance = api;
  }
})(typeof window !== 'undefined' ? window : global);
