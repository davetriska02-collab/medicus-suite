// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Submissions: pure-logic core (no chrome APIs, no DOM)
//
// The RAG (red/amber/green) threshold evaluation is the single source of truth
// for BOTH the Submissions module charts and the global #subRagStrip in panel.js.
// It previously lived inline in two places (submissions.js getRagLevel +
// panel.js _subRagLevel); both now import from here so the alert thresholds can
// never silently drift apart — a missed amber/red is a demand-management failure.
//
// Exported:
//   DEFAULT_SUB_THRESHOLDS         — shipped defaults (disabled until user opts in)
//   ragLevel(value, threshold)     — 'red' | 'amber' | null for one merged threshold
//   getRagLevel(key, value, thresholds) — convenience: look up key, then ragLevel

'use strict';

// Shipped defaults. `enabled:false` means the strip stays hidden until the user
// turns a category on in Submissions settings.
export const DEFAULT_SUB_THRESHOLDS = {
  medical: { amber: 30, red: 60, enabled: false },
  admin: { amber: 20, red: 40, enabled: false },
};

// Evaluate one already-resolved threshold object against a count.
// Returns null when disabled or below the amber line (so callers can treat
// null as "no alert" uniformly).
export function ragLevel(value, threshold) {
  if (!threshold || !threshold.enabled) return null;
  if (value >= (threshold.red || Infinity)) return 'red';
  if (value >= (threshold.amber || Infinity)) return 'amber';
  return null;
}

// Look up a category's threshold in a thresholds map, then evaluate it.
export function getRagLevel(key, value, thresholds) {
  return ragLevel(value, thresholds && thresholds[key]);
}
