// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Referrals patient-name search + clinician filter (pure ES module, no chrome/DOM)
//
// Today the priority/status chips filter the aggregated chart, but there is no
// way to find a single patient's referral(s) in the list, and the clinician
// dropdown the medical-secretary persona asked for (R3, whole-suite appraisal)
// does not exist at all — only the free-text clinician SEARCH on the "By
// clinician" chart tab. This module adds two independent, AND-combined filters
// on top of the raw referrals array the module has already fetched:
//
//   - patientNameFilter(rows, query)   — substring match on given+family name
//   - clinicianFilter(rows, clinician) — exact match on referringClinician
//   - applyReferralFilters(rows, {...}) — both combined (AND)
//   - collectClinicians(rows)          — sorted distinct clinician set, for the dropdown
//
// Deliberately dumb: no fuzzy matching, no ranking — this is a find-the-patient
// tool for a secretary working a phone call, not a search engine. Matches the
// existing clinicianSearch convention in referrals.js (case-insensitive substring).
//
// Consumed by referrals.js for BOTH the main aggregated list/chart AND the 2WW
// safety-net worklist (buildSafetyNet in shared/referrals-api.js) — both must
// honour the same active filters so a secretary searching for one patient never
// sees a different, unfiltered view in the safety-net card.

'use strict';

// Case-insensitive substring match against "given family" (and "family given",
// so a secretary can type either order) — mirrors the existing clinician-search
// convention (state.clinicianSearch) already used on the chart tab.
export function patientNameFilter(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = (query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((r) => {
    const given = (r && r.patientGivenName) || '';
    const family = (r && r.patientFamilyName) || '';
    const forward = `${given} ${family}`.toLowerCase();
    const reverse = `${family} ${given}`.toLowerCase();
    return forward.includes(q) || reverse.includes(q);
  });
}

// Exact match on referringClinician. Empty/falsy clinician = no filter (all rows).
export function clinicianFilter(rows, clinician) {
  const list = Array.isArray(rows) ? rows : [];
  if (!clinician) return list;
  return list.filter((r) => (r && r.referringClinician) === clinician);
}

// Both filters combined (AND) — a patient-name search AND a clinician pick both
// narrow the same result set, never widen it.
export function applyReferralFilters(rows, { patientName, clinician } = {}) {
  return clinicianFilter(patientNameFilter(rows, patientName), clinician);
}

// Distinct clinician names present in the loaded data, sorted alphabetically —
// the dropdown's option list. '(unknown)'/blank clinicians are excluded (nothing
// useful to filter to); referrals.js's own aggregate() already falls back raw
// rows may have referringClinician === '' or null.
export function collectClinicians(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const set = new Set();
  for (const r of list) {
    const c = r && r.referringClinician;
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// True when at least one filter is active — used to decide whether the CSV
// filename/header should disclose that the export is filtered.
export function filtersActive({ patientName, clinician } = {}) {
  return !!((patientName || '').trim() || clinician);
}

// Short human-readable description of the active filters, for the CSV header
// comment line and/or filename suffix. Returns '' when no filters are active.
//
// The free-text patientName is caller-supplied and ends up embedded in a CSV
// header COMMENT line (not a normal, csvCell-escaped data row) — a search
// string containing CR/LF could otherwise inject a forged extra "row" into
// the exported file. Strip line breaks here, in the pure/tested core, rather
// than relying on every caller to remember to sanitise before embedding.
export function describeFilters({ patientName, clinician } = {}) {
  const parts = [];
  const name = (patientName || '').replace(/[\r\n]+/g, ' ').trim();
  if (name) parts.push(`patient contains "${name}"`);
  if (clinician) parts.push(`clinician = "${clinician}"`);
  return parts.join(', ');
}
