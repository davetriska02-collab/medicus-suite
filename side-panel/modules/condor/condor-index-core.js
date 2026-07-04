// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Pressure Index: pure index/band math (no chrome/DOM)
//
// Single source of truth for the composite Practice Pressure Index (PPI), its
// AMBER/RED band, and the demand-vs-capacity "over limit" reconciliation.
// Extracted from condor.js's computeIndex() (unchanged formula/behaviour) so:
//   - condor.js (live headline strip + hero gauge + copy/CSV), ppi.js (the
//     gauge card) and practice-report.js (the report's current-snapshot block)
//     all read ONE implementation and can never quietly diverge.
//   - the component weightings (WR/queue/urgent/capacity) and the AMBER/RED
//     band thresholds are now a `config` parameter (item 8 — tunable index),
//     defaulting to exactly the historical hard-coded values when omitted.
//
// HARD SAFETY RULE (do not relax): the capacity floor — the band can never
// display GREEN while demand is at/over the available capacity — is applied
// UNCONDITIONALLY, AFTER any user-supplied weightings/thresholds have produced
// a raw band. No config shape can skip it: floorBand() runs on every call and
// only ever RAISES the band (GREEN→AMBER), never lowers one. See
// test-condor-index-core.js "safety floor" section for the regression proof
// (a fuzz sweep over weighting/threshold configs).

'use strict';

// Defaults — identical to the values that were hard-coded in condor.js /
// ppi.js before item 8. Any field omitted from a user config falls back here.
export const DEFAULT_WEIGHTS = {
  waitingRoom: 0.3, // arrivedCount / 10, capped 100
  queue: 0.25, // (medical+admin) / 40, capped 100
  urgent: 0.25, // urgentCount / 5, capped 100
  capacity: 0.2, // (minimum-remaining deficit) / minimum, capped 100
};

export const DEFAULT_THRESHOLDS = {
  amber: 40, // ppi >= amber && < red → AMBER
  red: 70, // ppi >= red → RED
};

// Sane clamp ranges — inputs outside these are pulled back in, never rejected
// outright (a fat-fingered "999" should not crash the meter, just be capped).
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 1;
const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 99;

function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

// Normalise a raw (possibly partial/malformed) user config into a complete,
// clamped { weights, thresholds } shape. Never throws — bad/missing input
// falls back to the historical defaults field-by-field.
export function normaliseIndexConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rw = r.weights && typeof r.weights === 'object' ? r.weights : {};
  const rt = r.thresholds && typeof r.thresholds === 'object' ? r.thresholds : {};

  const weights = {
    waitingRoom: clamp(rw.waitingRoom, WEIGHT_MIN, WEIGHT_MAX, DEFAULT_WEIGHTS.waitingRoom),
    queue: clamp(rw.queue, WEIGHT_MIN, WEIGHT_MAX, DEFAULT_WEIGHTS.queue),
    urgent: clamp(rw.urgent, WEIGHT_MIN, WEIGHT_MAX, DEFAULT_WEIGHTS.urgent),
    capacity: clamp(rw.capacity, WEIGHT_MIN, WEIGHT_MAX, DEFAULT_WEIGHTS.capacity),
  };

  let amber = clamp(rt.amber, THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLDS.amber);
  let red = clamp(rt.red, THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLDS.red);
  // Amber must stay strictly below red — an inverted or equal pair would make
  // the AMBER band vanish or invert the meaning of "worse". If violated after
  // clamping, fall back to the full default pair rather than guess a fix.
  if (!(amber < red)) {
    amber = DEFAULT_THRESHOLDS.amber;
    red = DEFAULT_THRESHOLDS.red;
  }

  return { weights, thresholds: { amber, red } };
}

// True when the given (already-normalised or raw) config differs from the
// shipped defaults — drives the "custom weightings" disclosure in COPY
// FIGURES / CSV (item 8) and the "Reset to defaults" button's enabled state.
export function isCustomConfig(config) {
  if (!config) return false;
  const n = normaliseIndexConfig(config);
  return (
    n.weights.waitingRoom !== DEFAULT_WEIGHTS.waitingRoom ||
    n.weights.queue !== DEFAULT_WEIGHTS.queue ||
    n.weights.urgent !== DEFAULT_WEIGHTS.urgent ||
    n.weights.capacity !== DEFAULT_WEIGHTS.capacity ||
    n.thresholds.amber !== DEFAULT_THRESHOLDS.amber ||
    n.thresholds.red !== DEFAULT_THRESHOLDS.red
  );
}

// The demand-vs-capacity reconciliation — identical logic to the pre-item-8
// condor.js computeIndex(), NOT configurable (component weights only affect
// the numeric ppi score, never this independent capacity check).
function capacityState(queueCount, remaining) {
  if (remaining === 0 && queueCount > 0) return 'over';
  if (remaining > 0) {
    const ratio = queueCount / remaining;
    return ratio >= 1.5 ? 'over' : ratio >= 1.0 ? 'at' : 'none';
  }
  return 'none';
}

// Apply the safety floor to a raw band: never GREEN while over capacity.
// UNCONDITIONAL — called once, last, on every computeIndex() result,
// regardless of what config produced rawBand. Only ever raises the band.
function floorBand(rawBand, overCapacity) {
  return overCapacity && rawBand === 'GREEN' ? 'AMBER' : rawBand;
}

// Compute the full index result from a Condor streams-shaped `data` object.
// `rawConfig` is an optional { weights, thresholds } override (item 8); when
// omitted or malformed, every field falls back to the shipped default.
//
// Returns the same shape as the pre-item-8 condor.js computeIndex():
//   { ppi, band, rawBand, floored, demandCount, capacityCount, capacityState,
//     overCapacity, arrivedCount, urgentCount, minimum, config, isCustom }
export function computeIndex(data, rawConfig) {
  const d = data || {};
  const { weights, thresholds } = normaliseIndexConfig(rawConfig);

  const arrivedCount = d.waitingRoom?.arrivedCount ?? 0;
  const medical = d.submissions?.totals?.medical ?? 0;
  const admin = d.submissions?.totals?.admin ?? 0;
  const queueCount = medical + admin;
  const urgentCount = d.requestMonitor?.urgentCount ?? 0;
  const remaining = d.slots?.totalRemaining ?? 0;
  const minimum = d.capacityPreset?.minimum ?? 0;

  const scoreA = Math.min((arrivedCount / 10) * 100, 100);
  const scoreB = Math.min((queueCount / 40) * 100, 100);
  const scoreC = Math.min((urgentCount / 5) * 100, 100);
  let scoreD = 0;
  if (minimum !== 0) {
    const deficit = Math.max(0, minimum - remaining);
    scoreD = Math.min((deficit / minimum) * 100, 100);
  }
  const ppi = Math.round(
    scoreA * weights.waitingRoom + scoreB * weights.queue + scoreC * weights.urgent + scoreD * weights.capacity
  );

  const capState = capacityState(queueCount, remaining);
  const overCapacity = capState !== 'none';

  const rawBand = ppi < thresholds.amber ? 'GREEN' : ppi < thresholds.red ? 'AMBER' : 'RED';
  // ── Safety floor — unconditional, applied AFTER user config (see module doc) ──
  const band = floorBand(rawBand, overCapacity);
  const floored = band !== rawBand;

  return {
    ppi,
    band,
    rawBand,
    floored,
    demandCount: queueCount,
    capacityCount: remaining,
    capacityState: capState,
    overCapacity,
    arrivedCount,
    urgentCount,
    minimum,
    scores: { waitingRoom: scoreA, queue: scoreB, urgent: scoreC, capacity: scoreD },
    config: { weights, thresholds },
    isCustom: isCustomConfig(rawConfig),
  };
}
