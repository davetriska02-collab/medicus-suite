// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Capacity Forecast: pure-logic core (no chrome APIs, no DOM)
//
// Extracted from capacity.js so the per-weekday minimum logic, preset-summary
// formatting and editor-form validation can be unit-tested in isolation.
//
// Exported:
//   DOW_KEYS                       — Sun-indexed day-of-week → preset key
//   WEEKDAYS                       — Mon-first {key,label} list for the editor
//   minimumForDate(preset, iso)    — per-weekday minimum, with legacy fallback
//   defaultMinimumByDay(legacyMin) — minimumByDay map from a legacy flat minimum
//   presetSummary(preset)          — compact "min N/weekday" summary string
//   validatePreset(form)           — { valid, error } for the editor save path

'use strict';

// Date#getDay() is Sunday-indexed (0=Sun … 6=Sat); map to the preset keys.
export const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Editor rows are Monday-first.
export const WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

// Per-weekday minimum for a given ISO date, falling back to the legacy flat
// `minimumPerDay` field (weekends = 0) for presets saved before minimumByDay.
export function minimumForDate(preset, dateISO) {
  if (!preset) return 0;
  const dow = new Date(dateISO + 'T12:00:00').getDay();
  const key = DOW_KEYS[dow];
  if (preset.minimumByDay && preset.minimumByDay[key] !== undefined) {
    return preset.minimumByDay[key];
  }
  // Legacy fallback: weekends carry no minimum; weekdays use the flat value.
  if (dow === 0 || dow === 6) return 0;
  return preset.minimumPerDay || 0;
}

// Build a minimumByDay map from a legacy flat minimum (weekdays = min, weekend = 0).
export function defaultMinimumByDay(legacyMin) {
  const m = legacyMin || 0;
  return { mon: m, tue: m, wed: m, thu: m, fri: m, sat: 0, sun: 0 };
}

// Compact summary line for the preset dropdown.
export function presetSummary(p) {
  const mins = p.minimumByDay;
  if (!mins) return `min ${p.minimumPerDay || 0}/day`;
  const values = WEEKDAYS.map((d) => mins[d.key] || 0);
  const allSame = values.slice(0, 5).every((v) => v === values[0]);
  if (allSame && values[5] === 0 && values[6] === 0) return `min ${values[0]}/weekday`;
  const wkTotal = values.reduce((a, b) => a + b, 0);
  return `min ${wkTotal}/week`;
}

// Validate the editor form. Returns { valid, error } — error is the message the
// caller surfaces (kept identical to the original inline alerts).
export function validatePreset({ name, slotTypes, tight, low }) {
  if (!name || !String(name).trim()) return { valid: false, error: 'Preset needs a name.' };
  if (!slotTypes || slotTypes.length === 0) return { valid: false, error: 'Select at least one slot type.' };
  if (low >= tight) return { valid: false, error: 'Low threshold must be below Tight threshold.' };
  if (tight >= 100 || low >= 100) return { valid: false, error: 'Thresholds must be below 100%.' };
  return { valid: true, error: null };
}
