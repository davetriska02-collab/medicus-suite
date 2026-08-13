// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Rota module: live-drift badge state (PURE).
//
// One decision, isolated so it can be tested: given the outcome of a live
// reconciliation against the Medicus appointment book, what should the panel
// badge say? No DOM, no chrome.*, no fetch — importable straight into node
// (test-rota-drift-state.js).
//
// The house rule this file encodes: absence of a check is NEVER a green light.
// A check that could not run degrades to amber "unavailable"; a check that was
// never attempted (no practice code, no rota for today) reads neutral
// "not checked". Only a completed check with zero discrepancies goes green.
//
// Severity mapping mirrors rota/engine/reconcile.js so the panel and the full
// app never disagree about what counts as serious:
//   missing-clinic   severity high   → red  (rostered clinic simply isn't built)
//   ghost-clinic     severity high   → red  (clinic built for someone on leave)
//   unplanned-clinic severity medium → amber
//   unknown-clinician severity info  → amber

'use strict';

// Every non-"ok" finding kind diffDay() can emit, in display order.
export const DRIFT_KINDS = ['missing-clinic', 'ghost-clinic', 'unplanned-clinic', 'unknown-clinician'];

// High-severity kinds. One of these means the appointment book and the rota
// disagree in a way that costs the practice capacity or strands patients.
export const RED_KINDS = ['missing-clinic', 'ghost-clinic'];
export const AMBER_KINDS = ['unplanned-clinic', 'unknown-clinician'];

// Compact phrases for the summary line ("1 missing clinic · 2 unplanned").
const PHRASE = {
  'missing-clinic': (n) => `${n} missing clinic${n === 1 ? '' : 's'}`,
  'ghost-clinic': (n) => `${n} ghost clinic${n === 1 ? '' : 's'}`,
  'unplanned-clinic': (n) => `${n} unplanned`,
  'unknown-clinician': (n) => `${n} not in registry`,
};

function count(counts, kind) {
  const n = Number((counts || {})[kind]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// "1 missing clinic · 2 unplanned" — empty string when nothing drifted.
export function driftDetail(counts) {
  return DRIFT_KINDS.filter((k) => count(counts, k) > 0)
    .map((k) => PHRASE[k](count(counts, k)))
    .join(' · ');
}

/**
 * Map a drift-check result to a badge state.
 *
 * @param {object|null} result
 *   { state: 'checked', counts, checkedAt }  — a live check completed
 *   { state: 'error', reason }               — the check ran and failed
 *   { state: 'skipped', reason }             — preconditions absent, never attempted
 *   null/undefined                           — nothing has happened yet
 * @returns {{level:'ok'|'amber'|'red'|'unavailable'|'neutral', label:string,
 *            detail:string, count:number, checkedAt:string}}
 */
export function driftBadgeState(result) {
  const r = result || {};
  const checkedAt = typeof r.checkedAt === 'string' ? r.checkedAt : '';

  // The check ran and failed. Amber, and it says why — never a silent green.
  if (r.state === 'error') {
    return {
      level: 'unavailable',
      label: 'Drift check unavailable',
      detail: String(r.reason || 'reason unknown'),
      count: 0,
      checkedAt,
    };
  }

  // Never attempted (no practice code, no rota for today, not mounted yet).
  // Neutral, not green: we are not claiming the book matches, only that we
  // have not looked.
  if (r.state !== 'checked') {
    return {
      level: 'neutral',
      label: 'Not checked',
      detail: String(r.reason || 'no live check has run yet'),
      count: 0,
      checkedAt,
    };
  }

  const red = RED_KINDS.reduce((a, k) => a + count(r.counts, k), 0);
  const amber = AMBER_KINDS.reduce((a, k) => a + count(r.counts, k), 0);
  const total = red + amber;

  // The ONLY green: a completed check with nothing to report.
  if (total === 0) {
    return {
      level: 'ok',
      label: checkedAt ? `In step with the book (checked ${checkedAt})` : 'In step with the book',
      detail: '',
      count: 0,
      checkedAt,
    };
  }

  return {
    level: red > 0 ? 'red' : 'amber',
    label: red > 0 ? 'Rota and book disagree' : 'Minor drift from the book',
    detail: driftDetail(r.counts),
    count: total,
    checkedAt,
  };
}
